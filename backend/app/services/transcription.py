"""Helpline call recordings -> text.

Gemma 4 (E2B/E4B) can transcribe speech through Hugging Face Transformers' "any-to-any"
pipeline, with a 30-second limit per clip at 16 kHz mono
(https://ai.google.dev/gemma/docs/capabilities/audio). Calls are therefore split into
30-second chunks and the transcripts joined. The model is loaded lazily and only when
TRANSCRIBER_BACKEND=gemma; install the optional extra with `pip install -e ".[audio]"`.

Without a speech model, recordings are still stored and the reviewer types the
transcript after listening (or the demo simulator supplies a typed stand-in).
"""

import asyncio
import io
import logging
import tempfile
import wave
from pathlib import Path
from typing import Protocol

from app.config import Settings

log = logging.getLogger("relieflens.transcription")
CHUNK_SECONDS = 30
TARGET_RATE = 16_000


class AudioRejected(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class TranscriberUnavailable(Exception):
    pass


def wav_duration(data: bytes) -> float:
    """Validate a WAV file and return its length in seconds."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getcomptype() != "NONE" or w.getsampwidth() not in (1, 2, 4):
                raise AudioRejected("UNSUPPORTED_AUDIO", "Send uncompressed PCM WAV audio.", 415)
            rate, frames = w.getframerate(), w.getnframes()
    except (wave.Error, EOFError) as exc:
        raise AudioRejected("UNSUPPORTED_AUDIO", "Send the recording as a WAV file.", 415) from exc
    if rate <= 0 or frames <= 0:
        raise AudioRejected("UNSUPPORTED_AUDIO", "The recording is empty.", 415)
    return frames / rate


def check_audio(data: bytes, settings: Settings) -> float:
    if len(data) > settings.max_audio_bytes:
        raise AudioRejected("AUDIO_TOO_LARGE", f"Recordings must be {settings.max_audio_bytes // (1024 * 1024)} MB "
                            "or smaller.", 413)
    seconds = wav_duration(data)
    if seconds > settings.max_call_seconds:
        raise AudioRejected("AUDIO_TOO_LONG", f"Recordings must be {settings.max_call_seconds // 60} minutes or "
                            "shorter.", 413)
    return seconds


def load_mono_16k(data: bytes):
    """WAV bytes -> float32 numpy array, mono, 16 kHz, range [-1, 1]."""
    import numpy as np

    with wave.open(io.BytesIO(data)) as w:
        rate, width, channels = w.getframerate(), w.getsampwidth(), w.getnchannels()
        raw = w.readframes(w.getnframes())
    dtype = {1: np.uint8, 2: np.int16, 4: np.int32}[width]
    samples = np.frombuffer(raw, dtype=dtype).astype(np.float32)
    if width == 1:
        samples = (samples - 128.0) / 128.0
    else:
        samples /= float(2 ** (8 * width - 1))
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if rate != TARGET_RATE:
        n = int(round(len(samples) * TARGET_RATE / rate))
        samples = np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples)
    return samples.astype(np.float32)


class Transcriber(Protocol):
    name: str

    def available(self) -> bool: ...

    async def transcribe(self, wav_bytes: bytes) -> str: ...


class NoTranscriber:
    """No speech model configured: recordings wait for a reviewer-typed transcript."""

    name = "none"

    def available(self) -> bool:
        return False

    async def transcribe(self, wav_bytes: bytes) -> str:
        raise TranscriberUnavailable("No speech model is configured (TRANSCRIBER_BACKEND=gemma enables Gemma 4).")


class GemmaTranscriber:
    def __init__(self, model_id: str, language: str):
        self.name = model_id
        self.language = language
        self._pipe = None
        self._lock = asyncio.Lock()

    def available(self) -> bool:
        try:
            import transformers  # noqa: F401
        except ImportError:
            return False
        return True

    def _prompt(self) -> str:
        if not self.language or self.language.lower() in ("auto", "original"):
            first = "Transcribe the following speech segment in its original language."
        else:
            first = f"Transcribe the following speech segment in {self.language} into {self.language} text."
        return first + " Only output the transcription, with no newlines. Write numbers as digits."

    def _load(self):
        if self._pipe is None:
            from transformers import GenerationConfig, pipeline

            log.info("loading %s (first call can take a while)", self.name)
            self._pipe = pipeline(task="any-to-any", model=self.name, device_map="auto", dtype="auto")
            config = GenerationConfig.from_pretrained(self.name)
            config.max_new_tokens = 256
            self._gen_kwargs = {"generation_config": config}
        return self._pipe

    def _transcribe_sync(self, wav_bytes: bytes) -> str:
        import numpy as np

        pipe = self._load()
        samples = load_mono_16k(wav_bytes)
        step = CHUNK_SECONDS * TARGET_RATE
        parts: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            for i, start in enumerate(range(0, len(samples), step)):
                chunk = samples[start:start + step]
                if len(chunk) < TARGET_RATE // 2:  # skip tails shorter than half a second
                    continue
                path = Path(tmp) / f"chunk{i}.wav"
                with wave.open(str(path), "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(TARGET_RATE)
                    w.writeframes((np.clip(chunk, -1, 1) * 32767).astype(np.int16).tobytes())
                messages = [{"role": "user", "content": [
                    {"type": "audio", "audio": str(path)},
                    {"type": "text", "text": self._prompt()},
                ]}]
                out = pipe(messages, return_full_text=False, generate_kwargs=self._gen_kwargs)
                parts.append(str(out[0]["generated_text"]).strip())
        return " ".join(p for p in parts if p).strip()

    async def transcribe(self, wav_bytes: bytes) -> str:
        if not self.available():
            raise TranscriberUnavailable('Install the audio extra: pip install -e ".[audio]"')
        async with self._lock:  # one call at a time on a laptop
            return await asyncio.to_thread(self._transcribe_sync, wav_bytes)


def build_transcriber(settings: Settings) -> Transcriber:
    if settings.transcriber_backend == "gemma":
        return GemmaTranscriber(settings.gemma_audio_model, settings.transcribe_language)
    return NoTranscriber()
