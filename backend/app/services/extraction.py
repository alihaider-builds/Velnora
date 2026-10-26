"""Extraction pipeline: model call -> schema validation (one retry) -> evidence matching -> rules."""

import re
from dataclasses import dataclass, field

from pydantic import ValidationError

from app.services.evidence import find_evidence
from app.services.llm.base import LLMClient
from app.services.llm.output_schema import ExtractionOutput
from app.services.normalize import ascii_digits

RAW_RESPONSE_LIMIT = 10_000

_NUMBER_WORDS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "panch": 5, "paanch": 5, "chay": 6, "chhe": 6, "saat": 7,
    "aath": 8, "nau": 9, "das": 10, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "چھ": 6, "سات": 7,
    "آٹھ": 8, "نو": 9, "دس": 10,
}


@dataclass
class ExtractionResult:
    status: str  # "succeeded" | "failed"
    attempts: int
    output: dict | None = None
    error: str | None = None
    raw_response: str | None = None
    language: str | None = None
    notes: list[str] = field(default_factory=list)


def _value_in_phrase(value: int, phrase: str) -> bool:
    digits = [int(d) for d in re.findall(r"\d+", ascii_digits(phrase))]
    if value in digits:
        return True
    words = re.findall(r"\w+", phrase.lower())
    return any(_NUMBER_WORDS.get(w) == value for w in words)


def ground_output(source: str, out: ExtractionOutput) -> dict:
    """Attach code-point evidence offsets to every field and apply post-validation rules."""
    uncertainties = list(out.uncertainties)

    used_needs: set[tuple[int, int]] = set()
    needs, seen = [], set()
    for n in out.needs:
        if n.category in seen:
            continue
        seen.add(n.category)
        ev = find_evidence(source, n.evidence.phrase, used_needs)
        if not ev["matched"]:
            uncertainties.append(f"Evidence not found for need '{n.category}'.")
        needs.append({"category": n.category, "evidence": ev})

    used_qty: set[tuple[int, int]] = set()
    quantities = []
    for q in out.quantities:
        ev = find_evidence(source, q.evidence.phrase, used_qty)
        if ev["matched"] and not _value_in_phrase(q.value, ev["phrase"]):
            ev = {"phrase": ev["phrase"], "start": None, "end": None, "matched": False}
        if not ev["matched"]:
            uncertainties.append(f"Evidence not found for quantity '{q.value} {q.label}'.")
        quantities.append({"value": q.value, "label": q.label, "evidence": ev})

    def text_field(f, name: str):
        if f is None:
            return None
        ev = find_evidence(source, f.evidence.phrase, set())
        if not ev["matched"]:
            uncertainties.append(f"Evidence not found for {name}.")
        return {"text": f.text, "evidence": ev}

    return {
        "language": out.language,
        "needs": needs,
        "quantities": quantities,
        "place_name": text_field(out.place_name, "place name"),
        "time_reference": text_field(out.time_reference, "time reference"),
        "uncertainties": uncertainties[:10],
    }


async def extract_fields(text: str, place_hint: str | None, llm: LLMClient,
                         categories: list[dict]) -> ExtractionResult:
    """Call the model, validate against the schema and the active categories, retry once."""
    feedback: str | None = None
    raw: str | None = None
    error: str | None = None
    for attempt in (1, 2):
        try:
            raw = await llm.extract(text, place_hint, categories, feedback)
        except Exception as exc:  # network errors, timeouts, bad responses
            error = f"Model unavailable ({type(exc).__name__})."
            continue
        try:
            out = ExtractionOutput.model_validate_json(raw, context={"categories": {c["key"] for c in categories}})
        except ValidationError as exc:
            feedback = str(exc)[:1500]
            error = "Model output did not match the schema."
            continue
        return ExtractionResult(
            status="succeeded",
            attempts=attempt,
            output=ground_output(text, out),
            raw_response=raw[:RAW_RESPONSE_LIMIT],
            language=out.language,
        )
    return ExtractionResult(
        status="failed",
        attempts=2,
        error=error,
        raw_response=raw[:RAW_RESPONSE_LIMIT] if raw else None,
    )
