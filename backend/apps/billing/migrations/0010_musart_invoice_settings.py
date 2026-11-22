"""Apply the business and payment details explicitly supplied for MUSart invoices.

Only existing MUSart studios are changed. General studio/profile data is untouched.
Invoice PDFs read these settings at issuance and archive the resulting values.
"""

from django.db import migrations


MUSART_INVOICE_SETTINGS = {
    "billing_sender_name": "Peter Müller",
    "billing_sender_street": "Lindenring 68",
    "billing_sender_postal_code": "15738",
    "billing_sender_city": "Zeuthen",
    "billing_sender_email": "musikunterricht@musart.de",
    "bank_account_holder": "Peter Müller",
    "bank_name": "Mittelbrandenburgische Sparkasse",
    "bank_iban": "DE36160500001102555645",
    "paypal_email": "xasteryia@googlemail.com",
}


def configure_musart(apps, schema_editor):
    Studio = apps.get_model("core", "Studio")
    for studio in Studio.objects.select_related("owner").all():
        name = (studio.name or "").lower().strip()
        studio_email = (studio.email or "").lower().strip()
        owner_email = (studio.owner.email or "").lower().strip()
        is_musart = (
            name == "musart"
            or name.startswith("musart ")
            or studio_email.endswith("@musart.de")
            or owner_email.endswith("@musart.de")
        )
        if not is_musart:
            continue
        current = studio.settings if isinstance(studio.settings, dict) else {}
        updated = {**current, **MUSART_INVOICE_SETTINGS}
        if updated != current:
            studio.settings = updated
            studio.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("billing", "0009_invoice_service_month")]

    operations = [
        migrations.RunPython(configure_musart, migrations.RunPython.noop),
    ]
