from typing import Protocol


class LLMClient(Protocol):
    """Returns the model's raw JSON text; validation happens in the extraction service."""

    name: str

    async def extract(self, text: str, place_hint: str | None, retry_feedback: str | None = None) -> str: ...

    async def is_available(self) -> bool: ...
