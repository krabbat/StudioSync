"""Fixed MUSart business signature in plain-text and HTML mail variants.

The composer provides only the personal message. The SMTP backend appends this
signature exactly once to each outgoing message, also on replies.
"""

from html import escape

SIGNATURE_NAME = "Musikunterricht Sartori"
SIGNATURE_CONTACT = "Peter Müller"
SIGNATURE_WEBSITE = "https://musart.de"
SIGNATURE_EMAIL = "musikunterricht@musart.de"

# Public PNG counterpart of the MUSart favicon.
# If the image URL is unavailable or blocked by the mail client, the complete
# signature remains legible without the image.
SIGNATURE_LOGO_URL = "https://musart.de/images/yootheme/favicon.png"


def plain_mail_with_signature(body: str) -> str:
    """Readable fallback for clients that do not display HTML/images."""
    signature = (
        f"{SIGNATURE_NAME}\n"
        f"{SIGNATURE_CONTACT}\n"
        f"{SIGNATURE_WEBSITE}\n"
        f"{SIGNATURE_EMAIL}"
    )
    return body.rstrip() + "\n\n-- \n" + signature


def html_mail_with_signature(body: str) -> str:
    """Escape arbitrary user text; format only fixed, trusted signature data."""
    safe_text = escape(body).replace("\r\n", "\n").replace("\r", "\n")
    safe_text = safe_text.replace("\n", "<br>")

    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"></head>'
        '<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;'
        'font-size:14px;line-height:1.55;color:#232323;">'
        f'<div style="overflow-wrap:anywhere;">{safe_text}</div>'
        '<div style="padding-top:18px;margin-top:18px;border-top:1px solid #dedede;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
        '<tr><td valign="top" style="padding:1px 12px 0 0;">'
        f'<img src="{escape(SIGNATURE_LOGO_URL, quote=True)}" alt="MUSart" '
        'width="48" height="48" style="display:block;width:48px;height:48px;'
        'border:0;outline:none;">'
        '</td><td valign="top" style="font-size:13px;line-height:1.5;">'
        f'<strong>{escape(SIGNATURE_NAME)}</strong><br>'
        f'{escape(SIGNATURE_CONTACT)}<br>'
        f'<a href="{escape(SIGNATURE_WEBSITE, quote=True)}" '
        'style="color:#285e90;text-decoration:underline;">'
        f'{escape(SIGNATURE_WEBSITE)}</a><br>'
        f'<a href="mailto:{escape(SIGNATURE_EMAIL, quote=True)}" '
        'style="color:#285e90;text-decoration:underline;">'
        f'{escape(SIGNATURE_EMAIL)}</a>'
        '</td></tr></table></div></body></html>'
    )
