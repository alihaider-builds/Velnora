"""LLM clients behind one interface. `build_llm_client` picks one from settings."""

from app.config import Settings
from app.services.llm.base import LLMClient
from app.services.llm.fake import FakeLLMClient
from app.services.llm.ollama import OllamaClient


def build_llm_client(settings: Settings) -> LLMClient:
    if settings.llm_backend == "ollama":
        return OllamaClient(settings.ollama_url, settings.ollama_model, settings.llm_timeout_seconds)
    return FakeLLMClient()


__all__ = ["LLMClient", "FakeLLMClient", "OllamaClient", "build_llm_client"]
