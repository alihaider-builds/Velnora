"""The exact JSON shape Gemma must return (BACKEND_TECH_SPEC.md §5.2).

Need categories come from the organizer's category list, so the allowed values are
passed in at validation time and written into the JSON schema sent to the model.
"""

import copy

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.schemas import Language


class EvidenceOut(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)


class NeedOut(BaseModel):
    category: str = Field(min_length=1, max_length=40)
    evidence: EvidenceOut

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str, info: ValidationInfo) -> str:
        allowed = (info.context or {}).get("categories")
        if allowed is not None and value not in allowed:
            raise ValueError(f"category must be one of: {', '.join(sorted(allowed))}")
        return value


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
    uncertainties: list[str] = Field(max_length=5)

    @field_validator("uncertainties")
    @classmethod
    def _short_notes(cls, notes: list[str]) -> list[str]:
        return [n.strip()[:200] for n in notes if n.strip()]


def output_json_schema(category_keys: list[str]) -> dict:
    schema = copy.deepcopy(ExtractionOutput.model_json_schema())
    schema["$defs"]["NeedOut"]["properties"]["category"]["enum"] = list(category_keys)
    return schema
