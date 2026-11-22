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


def currency(amount):
    return f"{amount:,.2f}".replace(",", "#").replace(".", ",").replace("#", ".") + " €"


def date_de(date):
    return date.strftime("%d.%m.%Y") if date else "–"


def _p(value):
    return escape(str(value or ""))


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
    return {
        "invoice_number": invoice.invoice_number,
        "issue_date": date_de(invoice.issue_date),
        "due_date": date_de(invoice.due_date),
        "service_period": (
            f"01.{invoice.service_month.month:02d}.{invoice.service_month.year} - "
            f"{monthrange(invoice.service_month.year, invoice.service_month.month)[1]:02d}."
            f"{invoice.service_month.month:02d}.{invoice.service_month.year}"
        ) if invoice.service_month else "",
        "sender_name": studio.owner.get_full_name().strip() or studio.name,
        "studio_name": studio.name,
        "sender_street": studio.address_line1,
        "sender_postal_code": studio.postal_code,
        "sender_city": studio.city,
        "sender_email": studio.email,
        "sender_web": studio.website,
        "sender_tax_id": str(studio_settings.get("billing_tax_number", "")),
        "recipient_name": recipient_name,
        "recipient_street": street,
        "recipient_postal_code": zip_code,
        "recipient_city": city,
        "recipient_email": email,
        "student_name": student.user.get_full_name().strip() if student else "",
        "payment_method": payment_method,
        "bank_holder": str(studio_settings.get("bank_account_holder") or studio.owner.get_full_name().strip()),
        "bank_name": str(studio_settings.get("bank_name", "")),
        "bank_iban": str(studio_settings.get("bank_iban", "")),
        "bank_bic": str(studio_settings.get("bank_bic", "")),
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
    navy = colors.HexColor("#18314D")
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
        story += [paragraph("Unterricht für: " + data["student_name"])]
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
    story += [table, Spacer(1, 7 * mm), paragraph(TAX_NOTICE, small), Spacer(1, 11 * mm)]
    payment = data["payment_method"]
    section = [paragraph("ZAHLUNGSINFORMATIONEN", subheading), Spacer(1, 3 * mm)]
    if Decimal(data["balance_due"]) <= 0:
        section.append(paragraph("Der Rechnungsbetrag wurde bereits vollständig bezahlt."))
    elif payment == "cash":
        section.append(paragraph("Barzahlung nach Vereinbarung, spätestens bis zum Fälligkeitstag."))
    elif payment == "paypal":
        section.append(paragraph("Für die Bezahlung erhalten Sie eine separate PayPal-Zahlungsaufforderung."))
    else:
        section.append(paragraph("Bitte überweisen Sie den offenen Betrag bis zum Fälligkeitstag."))
        if data["bank_iban"]:
            section += [
                paragraph("Kontoinhaber: " + data["bank_holder"], small),
                paragraph("Bank: " + data["bank_name"], small) if data["bank_name"] else Spacer(1, 0),
                paragraph("IBAN: " + data["bank_iban"], small),
                paragraph("BIC: " + data["bank_bic"], small) if data["bank_bic"] else Spacer(1, 0),
            ]
        else:
            section.append(paragraph("Bankverbindung: wie vereinbart.", small))
        section.append(paragraph("Verwendungszweck: " + data["invoice_number"], small))
    if data["notes"]:
        section += [Spacer(1, 4 * mm), paragraph(data["notes"], small)]
    story += [KeepTogether(section), Spacer(1, 11 * mm),
              HRFlowable(width="100%", thickness=.5, color=colors.HexColor("#DDE4ED")),
              Spacer(1, 3 * mm)]
    footer = line(data["sender_name"], data["sender_street"],
                  (data["sender_postal_code"] + " " + data["sender_city"]).strip())
    story.append(paragraph(footer, small))
    if data["sender_tax_id"]:
        story.append(paragraph("Steuernummer: " + data["sender_tax_id"], small))

    def page_number(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(muted)
        canvas.drawRightString(A4[0] - 23 * mm, 14 * mm, f"Seite {doc.page}")

    document.build(story, onFirstPage=page_number, onLaterPages=page_number)
    return buffer.getvalue()
