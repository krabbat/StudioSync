"""MUSart A4 invoices. An issued PDF is archived as immutable bytes on Invoice."""

from __future__ import annotations

from calendar import monthrange
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from .payment_status import effective_due_date

from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


TAX_NOTICE = "Umsatzsteuerfrei gemäß § 4 Nr. 21 Satz 1 Buchstabe c UStG."
PAYMENT_NOTICE = (
    "Bitte zahlen Sie den offenen Betrag innerhalb von 7 Tagen "
    "entsprechend der vereinbarten Zahlungsmodalität."
)


def currency(amount):
    return f"{amount:,.2f}".replace(",", "#").replace(".", ",").replace("#", ".") + " €"


def date_de(date):
    return date.strftime("%d.%m.%Y") if date else "–"


def _p(value):
    return escape(str(value or ""))


def lesson_subject(student):
    """Use the student's primary instrument to label the tuition, not a manual invoice field."""
    if not student:
        return "Musikunterricht"
    raw = (student.instrument or "").strip()
    if not raw and isinstance(student.instruments, list):
        raw = next((value.strip() for value in student.instruments
                    if isinstance(value, str) and value.strip()), "")
    if not raw:
        return "Musikunterricht"
    names = {
        "piano": "Klavier", "piano/keyboard": "Klavier", "guitar": "Gitarre",
        "violin": "Geige", "flute": "Flöte", "recorder": "Blockflöte",
        "saxophone": "Saxophon", "saxofon": "Saxophon",
        "accordion": "Akkordeon", "keyboard": "Keyboard",
        "music theory": "Musiktheorie", "ear training": "Gehörbildung",
        "geige/violine": "Geige", "saxophon/saxofon": "Saxophon",
    }
    instrument = names.get(raw.casefold(), raw)
    if instrument.casefold().endswith("unterricht"):
        return instrument
    if instrument.casefold() in {"musiktheorie", "gehörbildung", "musiktechnik"}:
        return instrument
    return instrument + "unterricht"


def invoice_snapshot(invoice):
    """Capture exactly the recipient/sender/payment data used for the document."""
    student = invoice.student
    profile = getattr(student, "billing_profile", None) if student else None
    studio = invoice.studio
    payment_method = profile.payment_method if profile else "bank_transfer"
    recipient_name = profile.recipient_name.strip() if profile else ""
    email = profile.recipient_email.strip() if profile else ""
    # Empty profile address fields explicitly mean "use current student address".
    override = bool(profile and (
        profile.recipient_address_line1 or profile.recipient_postal_code or profile.recipient_city
    ))
    street = profile.recipient_address_line1 if override else (student.address_line1 if student else "")
    zip_code = profile.recipient_postal_code if override else (student.postal_code if student else "")
    city = profile.recipient_city if override else (student.city if student else "")

    studio_settings = studio.settings if isinstance(studio.settings, dict) else {}
    period_end = invoice.service_month_end or invoice.service_month
    return {
        "invoice_number": invoice.invoice_number,
        "issue_date": date_de(invoice.issue_date),
        "due_date": date_de(effective_due_date(invoice)),
        "service_period": (
            f"01.{invoice.service_month.month:02d}.{invoice.service_month.year} - "
            f"{monthrange(period_end.year, period_end.month)[1]:02d}."
            f"{period_end.month:02d}.{period_end.year}"
        ) if invoice.service_month else "",
        "sender_name": str(studio_settings.get("billing_sender_name") or studio.owner.get_full_name().strip() or studio.name),
        "studio_name": studio.name,
        "sender_street": str(studio_settings.get("billing_sender_street") or studio.address_line1),
        "sender_postal_code": str(studio_settings.get("billing_sender_postal_code") or studio.postal_code),
        "sender_city": str(studio_settings.get("billing_sender_city") or studio.city),
        "sender_email": str(studio_settings.get("billing_sender_email") or studio.email),
        "sender_web": studio.website,
        "sender_tax_id": str(studio_settings.get("billing_tax_number", "")),
        "recipient_name": recipient_name,
        "recipient_street": street,
        "recipient_postal_code": zip_code,
        "recipient_city": city,
        "recipient_email": email,
        "student_name": student.user.get_full_name().strip() if student else "",
        "lesson_subject": lesson_subject(student),
        "payment_method": payment_method,
        "bank_holder": str(studio_settings.get("bank_account_holder") or studio.owner.get_full_name().strip()),
        "bank_name": str(studio_settings.get("bank_name", "")),
        "bank_iban": str(studio_settings.get("bank_iban", "")),
        "bank_bic": str(studio_settings.get("bank_bic", "")),
        "paypal_email": str(studio_settings.get("paypal_email", "")),
        "items": [
            {"description": item.description, "quantity": str(item.quantity),
             "unit_price": str(item.unit_price), "total": str(item.total_price)}
            for item in invoice.line_items.all()
        ],
        "subtotal": str(invoice.subtotal),
        "discount": str(invoice.discount_amount),
        "total": str(invoice.total_amount),
        "already_paid": str(invoice.amount_paid),
        "balance_due": str(max(invoice.balance_due, 0)),
        "notes": invoice.notes,
    }


def missing_billing_fields(invoice, data):
    """Prevent emailing incomplete or misleading invoices."""
    missing = []
    required = {
        "recipient_name": "Rechnungsempfänger",
        "recipient_email": "Rechnungs-E-Mail",
        "recipient_street": "Rechnungsanschrift: Straße",
        "recipient_postal_code": "Rechnungsanschrift: Postleitzahl",
        "recipient_city": "Rechnungsanschrift: Ort",
        "sender_street": "Absenderanschrift: Straße",
        "sender_postal_code": "Absenderanschrift: Postleitzahl",
        "sender_city": "Absenderanschrift: Ort",
    }
    for key, label in required.items():
        if not str(data.get(key) or "").strip():
            missing.append(label)
    if not invoice.student:
        missing.append("Schülerzuordnung")
    if not data["items"]:
        missing.append("Rechnungsposition")
    if invoice.tax_amount != 0:
        missing.append("Umsatzsteuer muss für MUSart-Unterricht 0,00 € sein")
    if invoice.total_amount <= 0:
        missing.append("positiver Rechnungsbetrag")
    return missing


def render_invoice_pdf(data):
    """Render a compact, multipage-safe A4 invoice, including supplied MUSart logo."""
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=23 * mm, rightMargin=23 * mm,
        topMargin=19 * mm, bottomMargin=19 * mm,
        title=f"Rechnung {data['invoice_number']}",
        author=data["studio_name"],
    )
    ink = colors.HexColor("#172237")
    muted = colors.HexColor("#657083")
    light = colors.HexColor("#F3F6FA")
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.4, leading=14, textColor=ink)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=11, textColor=muted)
    heading = ParagraphStyle("heading", parent=body, fontName="Helvetica-Bold", fontSize=15, leading=19)
    subheading = ParagraphStyle("subheading", parent=body, fontName="Helvetica-Bold", fontSize=10.5, leading=14)
    right = ParagraphStyle("right", parent=body, alignment=TA_RIGHT)
    right_small = ParagraphStyle("right-small", parent=small, alignment=TA_RIGHT)
    tablehead = ParagraphStyle("tablehead", parent=small, fontName="Helvetica-Bold", textColor=ink)
    amount = ParagraphStyle("amount", parent=right, fontName="Helvetica-Bold", fontSize=16, leading=20)
    page_width = A4[0] - 46 * mm

    def paragraph(s, style=body):
        return Paragraph(_p(s), style)

    def line(*pieces):
        return " · ".join(str(v) for v in pieces if v)

    logo = Path(settings.BASE_DIR) / "assets" / "branding" / "musart-logo.png"
    if logo.is_file():
        brand = Image(str(logo), width=66 * mm, height=18 * mm, kind="proportional")
    else:
        brand = paragraph("MUSart", heading)

    header_right = [
        paragraph(data["sender_name"], right),
        paragraph(data["studio_name"], right_small),
        paragraph(data["sender_street"], right_small),
        paragraph(line(data["sender_postal_code"], data["sender_city"]), right_small),
        paragraph(data["sender_email"], right_small),
    ]
    header = Table([[brand, header_right]], colWidths=[84 * mm, page_width - 84 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [header, Spacer(1, 15 * mm), HRFlowable(width="100%", thickness=1, color=colors.HexColor("#DDE4ED")), Spacer(1, 9 * mm)]
    recipient = [
        paragraph("RECHNUNG AN", small),
        Spacer(1, 4 * mm),
        paragraph(data["recipient_name"], subheading),
        paragraph(data["recipient_street"]),
        paragraph(line(data["recipient_postal_code"], data["recipient_city"])),
    ]
    dates = [
        paragraph("RECHNUNG", heading),
        Spacer(1, 3 * mm),
        paragraph("Nr. " + data["invoice_number"], right),
        paragraph("Rechnungsdatum: " + data["issue_date"], right_small),
        paragraph("Fällig am: " + data["due_date"], right_small),
    ]
    block = Table([[recipient, dates]], colWidths=[page_width * 0.54, page_width * 0.46])
    block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story += [block, Spacer(1, 12 * mm)]
    if data["student_name"]:
        story += [paragraph(
            data.get("lesson_subject", "Musikunterricht") + " für " + data["student_name"],
            subheading,
        )]
    if data.get("service_period"):
        story += [paragraph("Leistungszeitraum: " + data["service_period"], small)]
    story += [Spacer(1, 7 * mm)]

    rows = [[paragraph("LEISTUNG", tablehead), paragraph("MENGE", tablehead),
             paragraph("EINZELPREIS", tablehead), paragraph("BETRAG", tablehead)]]
    from decimal import Decimal
    for item in data["items"]:
        rows.append([
            paragraph(item["description"]),
            paragraph(item["quantity"]),
            paragraph(currency(Decimal(item["unit_price"])), right_small),
            paragraph(currency(Decimal(item["total"])), right),
        ])
    line_table = Table(rows, colWidths=[page_width * .55, page_width * .12, page_width * .16, page_width * .17],
                       repeatRows=1, hAlign="LEFT")
    line_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), light),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), .7, colors.HexColor("#DDE4ED")),
        ("LINEBELOW", (0, 1), (-1, -1), .35, colors.HexColor("#E5EAF0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
    ]))
    story += [line_table, Spacer(1, 9 * mm)]
    totals = [
        [paragraph("Rechnungsbetrag", body), paragraph(currency(Decimal(data["total"])), right)],
    ]
    if Decimal(data["discount"]):
        totals.insert(0, [paragraph("Nachlass bereits berücksichtigt", small), paragraph(currency(Decimal(data["discount"])), right_small)])
    if Decimal(data["already_paid"]):
        totals.append([paragraph("Bereits bezahlt", body), paragraph(currency(Decimal(data["already_paid"])), right)])
    totals.append([paragraph("Noch zu zahlen", subheading), paragraph(currency(Decimal(data["balance_due"])), amount)])
    table = Table(totals, colWidths=[46 * mm, 38 * mm], hAlign="RIGHT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, -1), (-1, -1), light),
        ("TOPPADDING", (0, -1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [
        table, Spacer(1, 7 * mm),
        paragraph(TAX_NOTICE, small),
        Spacer(1, 2 * mm),
        paragraph(PAYMENT_NOTICE, small),
        Spacer(1, 7 * mm),
    ]
    # All agreed payment options are printed, regardless of the preferred method.
    # The preferred method in the student's billing profile controls follow-up workflow.
    section = [paragraph("ZAHLUNGSMÖGLICHKEITEN", subheading), Spacer(1, 3 * mm)]
    if Decimal(data["balance_due"]) <= 0:
        section += [paragraph("Dieser Rechnungsbetrag ist bereits vollständig bezahlt.", small),
                    Spacer(1, 3 * mm)]
    else:
        section.append(Spacer(1, 3 * mm))
    bank_lines = []
    if data.get("bank_holder"):
        bank_lines.append(paragraph("Empfänger: " + data["bank_holder"], small))
    if data.get("bank_name"):
        bank_lines.append(paragraph("Bank: " + data["bank_name"], small))
    if data.get("bank_iban"):
        bank_lines.append(paragraph("IBAN: " + data["bank_iban"], small))
    if data.get("bank_bic"):
        bank_lines.append(paragraph("BIC: " + data["bank_bic"], small))
    bank_lines.append(paragraph("Verwendungszweck: " + data["invoice_number"], small))
    bank_section = [paragraph("Banküberweisung", body)] + bank_lines
    paypal_section = [paragraph("PayPal", body)]
    if data.get("paypal_email"):
        paypal_section.append(paragraph(data["paypal_email"], small))
    else:
        paypal_section.append(paragraph("Nach Vereinbarung", small))
    cash_section = [
        paragraph("Barzahlung", body),
        paragraph("Nach Vereinbarung möglich.", small),
    ]
    section += bank_section + [Spacer(1, 3 * mm)] + paypal_section + [
        Spacer(1, 3 * mm)] + cash_section
    if data["notes"]:
        section += [Spacer(1, 4 * mm), paragraph(data["notes"], small)]
    story.append(KeepTogether(section))
    footer = line(data["sender_name"], data["sender_street"],
                  (data["sender_postal_code"] + " " + data["sender_city"]).strip())

    def page_number(canvas, doc):
        # Fixed footer: avoids a nearly empty second A4 page for normal invoices.
        canvas.setStrokeColor(colors.HexColor("#DDE4ED"))
        canvas.setLineWidth(.5)
        canvas.line(23 * mm, 20 * mm, A4[0] - 23 * mm, 20 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(muted)
        canvas.drawString(23 * mm, 14 * mm, footer)
        if data["sender_tax_id"]:
            canvas.drawString(23 * mm, 10 * mm,
                              "Steuernummer: " + data["sender_tax_id"])
        canvas.drawRightString(A4[0] - 23 * mm, 14 * mm, f"Seite {doc.page}")

    document.build(story, onFirstPage=page_number, onLaterPages=page_number)
    return buffer.getvalue()
