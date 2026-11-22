"""MUSart IMAP connection validation; no messages are downloaded or marked read."""

import imaplib
import logging
import ssl

from apps.core.security import assert_public_host

LOG = logging.getLogger(__name__)


class ImapSetupError(Exception):
    """A user-facing, sanitized IMAP configuration or connection failure."""


def check_imap_connection(config):
    """Authenticate over verified TLS and close the connection without reading mail."""
    host = str(config.get("imap_host") or "").strip()
    username = str(config.get("imap_username") or "").strip()
    password = config.get("imap_password") or ""
    security = str(config.get("imap_security") or "ssl").strip().lower()
    try:
        port = int(config.get("imap_port") or (143 if security == "starttls" else 993))
    except (ValueError, TypeError) as exc:
        raise ImapSetupError("Ungültiger IMAP-Port.") from exc

    if not host or not username or not password:
        raise ImapSetupError("Bitte IMAP-Server, Benutzername und Passwort hinterlegen.")
    if len(host) > 253 or any(c.isspace() for c in host):
        raise ImapSetupError("Ungültiger IMAP-Servername.")
    if (security, port) not in {("ssl", 993), ("starttls", 143)}:
        raise ImapSetupError("Nur IMAP mit SSL/TLS (993) oder STARTTLS (143) ist zulässig.")
    try:
        assert_public_host(host, port)
    except (ValueError, OSError) as exc:
        raise ImapSetupError("Der angegebene IMAP-Server ist nicht zulässig oder nicht erreichbar.") from exc

    client = None
    try:
        tls = ssl.create_default_context()
        if security == "ssl":
            client = imaplib.IMAP4_SSL(host, port, ssl_context=tls, timeout=10)
        else:
            client = imaplib.IMAP4(host, port, timeout=10)
            client.starttls(ssl_context=tls)
        client.login(username, password)
        # NOOP tests an authenticated session without reading, moving, deleting,
        # or marking any mailbox message.
        result, _ = client.noop()
        if result != "OK":
            raise ImapSetupError("IMAP-Server hat die Verbindung nicht bestätigt.")
    except imaplib.IMAP4.error as exc:
        LOG.warning("IMAP login/command failed for %s", host)
        raise ImapSetupError("IMAP-Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.") from exc
    except ImapSetupError:
        raise
    except (OSError, ssl.SSLError, TimeoutError, ValueError) as exc:
        LOG.warning("IMAP connection failed for %s (%s)", host, type(exc).__name__)
        raise ImapSetupError("IMAP-Verbindung fehlgeschlagen. Server, Port und TLS prüfen.") from exc
    finally:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass
    return True
