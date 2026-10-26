"""Application settings, read from environment variables and `.env` files."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Model
    llm_backend: str = "fake"  # "ollama" | "fake"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4:e4b"
    llm_timeout_seconds: float = 90.0

    # Call transcription (Gemma 4 audio via Hugging Face Transformers; optional "audio" extra)
    transcriber_backend: str = "fake"  # "gemma" | "fake"
    gemma_audio_model: str = "google/gemma-4-E4B-it"
    transcribe_language: str = "Urdu"
    max_call_seconds: int = 300
    max_audio_bytes: int = 10 * 1024 * 1024

    # Auth
    reviewer_password_hash: str = ""
    session_secret: str = ""
    session_max_age_seconds: int = 12 * 60 * 60

    # Storage
    database_path: str = "storage/relieflens.db"
    upload_dir: str = "storage/uploads"
    max_image_bytes: int = 5 * 1024 * 1024
    max_request_bytes: int = 12 * 1024 * 1024

    # Geocoding: Google when GOOGLE_MAPS_API_KEY is set, otherwise OpenStreetMap Nominatim
    geocoder_enabled: bool = True
    google_maps_api_key: str = ""
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    photon_url: str = "https://photon.komoot.io"  # type-ahead place suggestions without a Google key
    nominatim_user_agent: str = "ReliefLens/0.1 (+https://github.com/alihaider-builds/Velnora)"

    # Duplicates
    dup_max_km: float = 2.0
    dup_max_hours: float = 24.0
    dup_min_score: float = 0.6

    # SMS / WhatsApp
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_validate_signature: bool = True
    public_base_url: str = ""
    # SMS to your own SIM via "SMS Gateway for Android" (sms-gate.app) on the helpline phone
    sms_gateway_signing_key: str = ""  # app: Settings > Webhooks > Signing Key
    sms_gateway_reply: bool = False  # send the reference back by SMS from the helpline phone
    sms_gateway_api_url: str = "https://api.sms-gate.app/3rdparty/v1"
    sms_gateway_username: str = ""
    sms_gateway_password: str = ""
    # SMS to your own SIM via textbee (textbee.dev) on the helpline phone
    textbee_signing_secret: str = ""  # 20+ characters; sent to textbee when the dashboard connects
    textbee_api_key: str = ""  # textbee dashboard API key (connect + reply SMS)
    textbee_reply: bool = False
    textbee_api_url: str = "https://api.textbee.dev/api/v1"
    # Requests that arrive through a Cloudflare tunnel may only reach the /api/inbound/* webhooks, so a
    # public tunnel never exposes sign-in or report data.
    tunnel_inbound_only: bool = True
    sender_hash_secret: str = ""
    helpline_emergency_number: str = "1122"

    # Privacy, demo and limits
    public_coord_decimals: int = 2
    demo_mode: bool = True
    cors_origins: str = ""
    rate_limit_enabled: bool = True

    def resolve(self, path: str) -> Path:
        """Resolve a configured path relative to the backend folder."""
        p = Path(path)
        return p if p.is_absolute() else BACKEND_DIR / p

    @property
    def model_name(self) -> str:
        return self.ollama_model if self.llm_backend == "ollama" else "fake-heuristic"
