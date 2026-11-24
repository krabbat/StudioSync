"""Mail footer rendering: safe HTML, readable text and fixed MUSart identity."""

from apps.core.mail_signature import (
    SIGNATURE_EMAIL,
    SIGNATURE_LOGO_URL,
    SIGNATURE_NAME,
    SIGNATURE_WEBSITE,
    html_mail_with_signature,
    plain_mail_with_signature,
)


def test_plain_signature_appended_once_below_original_text():
    body = "Guten Tag!\nBitte die Übungen bis Dienstag bearbeiten."
    result = plain_mail_with_signature(body)
    assert result.startswith(body)
    assert result.count("Musikunterricht Sartori") == 1
    assert result.endswith(
        "Musikunterricht Sartori\n"
        "Peter Müller\n"
        "https://musart.de\n"
        "musikunterricht@musart.de"
    )
    assert "\n-- \n" in result


def test_html_signature_formats_logo_contacts_and_escapes_student_body():
    body = "Hallo <Test> & Familie\nEine Zeile <script>alert(1)</script>"
    result = html_mail_with_signature(body)
    assert "<script>" not in result
    assert "&lt;script&gt;" in result
    assert "&lt;Test&gt; &amp; Familie<br>Eine Zeile" in result
    assert f'src="{SIGNATURE_LOGO_URL}"' in result
    assert 'alt="MUSart"' in result
    assert f"<strong>{SIGNATURE_NAME}</strong>" in result
    assert "Peter Müller" in result
    assert f'href="{SIGNATURE_WEBSITE}"' in result
    assert f'href="mailto:{SIGNATURE_EMAIL}"' in result
    assert result.count("<strong>Musikunterricht Sartori</strong>") == 1
