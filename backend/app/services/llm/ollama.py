"""Gemma 4 through Ollama's /api/chat with JSON-schema-constrained output."""

import httpx

from app.services.llm.output_schema import output_json_schema
from app.services.llm.prompt import build_messages


class OllamaClient:
    def __init__(self, base_url: str, model: str, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.name = model
        self.timeout = timeout

    async def extract(self, text: str, place_hint: str | None, retry_feedback: str | None = None) -> str:
        payload = {
            "model": self.name,
            "messages": build_messages(text, place_hint, retry_feedback),
            "format": output_json_schema(),
            "stream": False,
            "options": {"temperature": 0},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json()["message"]["content"]

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                names = {m.get("name") for m in resp.json().get("models", [])}
                return self.name in names or f"{self.name}:latest" in names
        except (httpx.HTTPError, ValueError):
            return False
