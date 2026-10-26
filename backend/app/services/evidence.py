"""Deterministic evidence matching: find the model's quoted phrase in the original text.

Offsets are Unicode code-point indices into the original text (Python str indices),
end-exclusive, as defined in the API contract.
"""

from app.services.normalize import normalize_with_map


def _unmatched(phrase: str) -> dict:
    return {"phrase": phrase, "start": None, "end": None, "matched": False}


def find_evidence(source: str, phrase: str, used: set[tuple[int, int]] | None = None) -> dict:
    """Locate `phrase` in `source`: exact match first, then normalized match.

    `used` holds spans already claimed by other fields of the same type; the first
    unused occurrence wins. The chosen span is added to `used`.
    """
    used = used if used is not None else set()
    phrase = phrase or ""
    if not phrase.strip():
        return _unmatched(phrase)

    # 1. Exact search
    start = source.find(phrase)
    while start != -1:
        span = (start, start + len(phrase))
        if span not in used:
            used.add(span)
            return {"phrase": phrase, "start": span[0], "end": span[1], "matched": True}
        start = source.find(phrase, start + 1)

    # 2. Normalized search, mapped back to original offsets
    norm_src, index_map = normalize_with_map(source)
    norm_phrase, _ = normalize_with_map(phrase)
    if norm_phrase:
        pos = norm_src.find(norm_phrase)
        while pos != -1:
            span = (index_map[pos], index_map[pos + len(norm_phrase) - 1] + 1)
            if span not in used:
                used.add(span)
                return {"phrase": phrase, "start": span[0], "end": span[1], "matched": True}
            pos = norm_src.find(norm_phrase, pos + 1)

    return _unmatched(phrase)
