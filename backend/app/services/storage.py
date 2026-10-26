"""Image checks and private local storage.

Images are identified by content (not by extension or declared type), re-encoded
with Pillow, which drops EXIF metadata including GPS location, and saved under a
random name outside any public folder.
"""

import io
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.transcription import check_audio

ALLOWED_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}
MEDIA_TYPES = {ext: mime for ext, mime in ALLOWED_FORMATS.values()}


class ImageRejected(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def save_image(data: bytes, upload_dir: Path, max_bytes: int) -> str:
    """Validate and store an image; returns the stored file name."""
    if len(data) > max_bytes:
        raise ImageRejected("IMAGE_TOO_LARGE", f"Images must be {max_bytes // (1024 * 1024)} MB or smaller.", 413)
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format
            probe.verify()
        if fmt not in ALLOWED_FORMATS:
            raise ImageRejected("UNSUPPORTED_IMAGE", "Only JPG, PNG and WebP images are accepted.", 415)
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            if fmt == "JPEG" and img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            ext, _ = ALLOWED_FORMATS[fmt]
            name = f"{uuid.uuid4().hex}.{ext}"
            upload_dir.mkdir(parents=True, exist_ok=True)
            img.save(upload_dir / name, format=fmt)  # no exif= argument: metadata is dropped
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageRejected("UNSUPPORTED_IMAGE", "Only JPG, PNG and WebP images are accepted.", 415) from exc
    return name


def media_type(name: str) -> str:
    return MEDIA_TYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream")


def delete_image(upload_dir: Path, name: str | None) -> None:
    if name:
        (upload_dir / name).unlink(missing_ok=True)


def save_audio(data: bytes, upload_dir: Path, settings) -> tuple[str, float]:
    """Validate a WAV recording (size, format, length) and store it privately.

    Raises AudioRejected. Returns (file name, length in seconds).
    """
    seconds = check_audio(data, settings)
    upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.wav"
    (upload_dir / name).write_bytes(data)
    return name, seconds
