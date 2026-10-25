"""Text normalization for Roman Urdu, Urdu script and English.

The original text is never changed. `normalize_with_map` also returns, for every
character of the normalized string, the index of the original character it came
from, so matches found in normalized text can be mapped back to the original.
"""

import re
import unicodedata

_ZERO_WIDTH = {"​", "‌", "‍", "‎", "‏", "⁠", "﻿"}
_URDU_LETTER_VARIANTS = {"ي": "ی", "ى": "ی", "ك": "ک", "ة": "ہ"}
_WORD_VARIANTS = {
    "main": "mein", "me": "mein", "men": "mein", "mai": "mein",
    "chahye": "chahiye", "chahie": "chahiye", "chaheye": "chahiye", "chahiay": "chahiye", "chahiyay": "chahiye",
    "dawa": "dawai", "dawae": "dawai", "dawaee": "dawai", "dwai": "dawai",
    "gher": "ghar",
    "bachey": "bachay", "bache": "bachay", "bachy": "bachay", "bachon": "bachay",
    "pni": "pani",
    "mdad": "madad",
    "khna": "khana",
}


def _is_diacritic(ch: str) -> bool:
    cp = ord(ch)
    return 0x064B <= cp <= 0x065F or cp == 0x0670


def _is_punct(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("P", "S")


def normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Normalize text, returning (normalized, index_map) where index_map[i] is the
    index in `text` of the character that produced normalized[i]."""
    out: list[str] = []
    idx: list[int] = []
    for i, raw in enumerate(text):
        for ch in unicodedata.normalize("NFKC", raw):
            if ch in _ZERO_WIDTH or _is_diacritic(ch):
                continue
            ch = _URDU_LETTER_VARIANTS.get(ch, ch).lower()
            if _is_punct(ch) or ch.isspace():
                ch = " "
            if ch == " ":
                if not out or out[-1] == " ":
                    continue
            elif out and ch.isascii() and ch.isalpha() and out[-1] == ch:
                continue  # collapse repeated Latin letters: paani -> pani
            out.append(ch)
            idx.append(i)
    while out and out[-1] == " ":
        out.pop()
        idx.pop()
    return "".join(out), idx


def normalize(text: str) -> str:
    return normalize_with_map(text)[0]


def normalize_for_compare(text: str) -> str:
    """Normalization plus common Roman Urdu spelling variants, for similarity scoring."""
    return " ".join(_WORD_VARIANTS.get(tok, tok) for tok in normalize(text).split())


_URDU_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def ascii_digits(text: str) -> str:
    return text.translate(_URDU_DIGITS)


_WS = re.compile(r"\s+")


def collapse_ws(text: str) -> str:
    return _WS.sub(" ", text).strip()
