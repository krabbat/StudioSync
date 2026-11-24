"""Email validation with German SMTPUTF8 mailbox characters."""
import re
import unicodedata

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import serializers

_ATOM = r"A-Za-z0-9!#$%&\u0027*+/=?^_`{|}~\\-äöüÄÖÜßẞ"
_LOCAL = re.compile(rf"[{_ATOM}]+(?:\\.[{_ATOM}]+)*\\Z")
_ERROR = "Bitte eine gültige E-Mail-Adresse eingeben."


def validate_international_email(value):
    """Accept ordinary addresses plus German letters before @ and IDNs."""
    if not isinstance(value, str):
        raise ValidationError(_ERROR)
    address = unicodedata.normalize("NFC", value.strip())
    if not address or any(char.isspace() for char in address):
        raise ValidationError(_ERROR)
    try:
        validate_email(address)
        return address
    except ValidationError:
        pass
    if address.count("@") != 1:
        raise ValidationError(_ERROR)
    local, domain = address.rsplit("@", 1)
    if not _LOCAL.fullmatch(local) or len(local.encode("utf-8")) > 64:
        raise ValidationError(_ERROR)
    try:
        validate_email("mailbox@" + domain)
    except ValidationError as exc:
        raise ValidationError(_ERROR) from exc
    return address


class InternationalEmailField(serializers.CharField):
    default_error_messages = {"invalid_email": _ERROR}

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_length", 320)
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return validate_international_email(value)
        except ValidationError:
            self.fail("invalid_email")
