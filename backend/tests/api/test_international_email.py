"""Regressions for German SMTPUTF8 mailbox support."""
import pytest
from django.core.exceptions import ValidationError
from rest_framework import serializers

from apps.core.international_email import (
    InternationalEmailField,
    validate_international_email,
)
from apps.core.mail_outbound import _smtp_utf8_bytes


@pytest.mark.parametrize("address", [
    "koßagk@musart.de", "müller@musart.de", "ÄRGER@musart.de",
    "GRÖSSE@musart.de", "groẞ@musart.de", "straße@müller.de",
    "max.mustermann+test@example.org",
])
def test_german_mailboxes_are_valid(address):
    assert validate_international_email(address) == address
    assert InternationalEmailField().run_validation(address) == address


@pytest.mark.parametrize("address", [
    "kein-at-zeichen", "a..b@musart.de", "a b@musart.de",
    "müller@", "@musart.de", "müller@-musart.de", "foo@@musart.de",
])
def test_broken_mailboxes_stay_invalid(address):
    with pytest.raises(ValidationError):
        validate_international_email(address)
    with pytest.raises(serializers.ValidationError):
        InternationalEmailField().run_validation(address)


def test_smtputf8_message_preserves_international_address_and_message_id():
    raw = _smtp_utf8_bytes(
        sender="musikunterricht@musart.de",
        recipient="koßagk@musart.de",
        studio_name="MUSart",
        subject="Unterricht",
        plain="Hallo", html="<p>Hallo</p>",
        attachments=[], message_id="<example@musart.de>",
    )
    assert "koßagk@musart.de".encode("utf-8") in raw
    assert b"Message-ID: <example@musart.de>" in raw
    assert b"multipart/alternative" in raw
