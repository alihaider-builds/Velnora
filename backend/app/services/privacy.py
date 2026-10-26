"""Phone masking, sender handling and the public (privacy-filtered) projection."""

import hashlib
import hmac
import re

# Pakistani mobile numbers (local and international forms) plus any long digit run.
_PHONE = re.compile(
    r"(?:\+|00)\s?92[\s-]?3\d{2}[\s-]?\d{7}"
    r"|(?<!\d)03\d{2}[\s-]?\d{7}(?!\d)"
    r"|(?<!\d)\d(?:[\s-]?\d){9,}(?!\d)"
)
_KEEP_PREFIX = re.compile(r"^(?:\+\s?92|0092|03)")
MASK = "•"


def _mask_match(m: re.Match) -> str:
    s = m.group(0)
    prefix = _KEEP_PREFIX.match(s)
    keep = prefix.end() if prefix else 0
    return s[:keep] + "".join(MASK if c.isdigit() else c for c in s[keep:])


def mask_phones(text: str) -> str:
    """Replace phone-number digits with a bullet. Keeps the same length, so text
    offsets computed on the original also line up with the masked text."""
    return _PHONE.sub(_mask_match, text)


def normalize_phone(raw: str) -> str:
    """'whatsapp:+92 300-1234567' / '03001234567' / '00923001234567' -> '+923001234567'."""
    s = raw.strip()
    if s.lower().startswith("whatsapp:"):
        s = s[len("whatsapp:"):]
    digits = re.sub(r"\D", "", s)
    if digits.startswith("0092"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = "92" + digits[1:]
    return "+" + digits


def mask_sender(number: str) -> str:
    """'+923001234541' -> '+92 3•• ••• ••41'."""
    digits = re.sub(r"\D", "", number)
    if digits.startswith("92") and len(digits) == 12:
        return f"+92 {digits[2]}{MASK * 2} {MASK * 3} {MASK * 2}{digits[-2:]}"
    if len(digits) <= 2:
        return MASK * 4
    return "+" + MASK * (len(digits) - 2) + digits[-2:]


def sender_hash(number: str, secret: str) -> str:
    return hmac.new(secret.encode(), normalize_phone(number).encode(), hashlib.sha256).hexdigest()


def round_coord(value: float, decimals: int) -> float:
    return round(value, decimals)


def area_label(label: str | None) -> str:
    """Shorten a place label for public display: drop the country, keep up to 3 parts."""
    if not label:
        return "Unknown area"
    parts = [p.strip() for p in label.split(",") if p.strip()]
    parts = [p for p in parts if p.lower() not in ("pakistan", "پاکستان")]
    return ", ".join(parts[:3]) or "Unknown area"
