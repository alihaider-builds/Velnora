from typing import Protocol


class LLMClient(Protocol):
    """Returns the model's raw JSON text; validation happens in the extraction service.

    `categories` is the organizer's active category list: dicts with key, label,
    label_ur and keywords.
    """

    name: str

    async def extract(self, text: str, place_hint: str | None, categories: list[dict],
                      retry_feedback: str | None = None) -> str: ...

    async def is_available(self) -> bool: ...
