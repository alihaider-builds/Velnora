"""The exact JSON shape Gemma must return (BACKEND_TECH_SPEC.md §5.2)."""

from pydantic import BaseModel, Field, field_validator

from app.schemas import Language, NeedCategory, Urgency


class EvidenceOut(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)


class NeedOut(BaseModel):
    category: NeedCategory
    evidence: EvidenceOut


class QuantityOut(BaseModel):
    value: int = Field(ge=0, le=100_000)
    label: str = Field(min_length=1, max_length=50)
    evidence: EvidenceOut


class TextFieldOut(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    evidence: EvidenceOut


class ExtractionOutput(BaseModel):
    language: Language
    needs: list[NeedOut] = Field(max_length=10)
    quantities: list[QuantityOut] = Field(max_length=10)
    place_name: TextFieldOut | None
    time_reference: TextFieldOut | None
    urgency_suggestion: Urgency
    uncertainties: list[str] = Field(max_length=5)

    @field_validator("uncertainties")
    @classmethod
    def _short_notes(cls, notes: list[str]) -> list[str]:
        return [n.strip()[:200] for n in notes if n.strip()]


def output_json_schema() -> dict:
    return ExtractionOutput.model_json_schema()
