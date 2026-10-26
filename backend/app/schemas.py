"""API request/response models. These mirror BACKEND_TECH_SPEC.md §4 exactly."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

# Need categories are managed by the organizer (GET /api/categories); keys are validated at runtime.
NeedCategory = Annotated[str, StringConstraints(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")]
Urgency = Literal["low", "medium", "high", "unknown"]
ReportStatus = Literal["pending_review", "approved", "rejected", "flagged", "merged"]
ExtractionStatus = Literal["pending", "running", "succeeded", "failed"]
Language = Literal["roman_urdu", "urdu", "english", "pashto", "mixed", "unknown"]
LocationSource = Literal["submitter_pin", "geocoder_candidate", "reviewer_pin"]
ReviewAction = Literal["approve", "reject", "flag", "reopen"]
Channel = Literal["web", "sms", "whatsapp", "call"]
TranscriptStatus = Literal["pending", "running", "succeeded", "failed", "manual"]

URGENCIES: tuple[str, ...] = ("low", "medium", "high", "unknown")


# ---------- shared objects ----------


class Evidence(BaseModel):
    phrase: str
    start: int | None
    end: int | None
    matched: bool


class NeedItem(BaseModel):
    category: NeedCategory
    evidence: Evidence


class QuantityItem(BaseModel):
    value: int
    label: str
    evidence: Evidence


class TextField(BaseModel):
    text: str
    evidence: Evidence


class Extraction(BaseModel):
    status: ExtractionStatus
    model: str | None
    attempts: int
    completed_at: str | None
    error: str | None
    language: Language | None
    needs: list[NeedItem]
    quantities: list[QuantityItem]
    place_name: TextField | None
    time_reference: TextField | None
    uncertainties: list[str]


class QuantityCorrection(BaseModel):
    value: int = Field(ge=0, le=100_000)
    label: str = Field(min_length=1, max_length=50)


class ReviewerFields(BaseModel):
    needs: list[NeedCategory] | None = None
    quantities: list[QuantityCorrection] | None = Field(default=None, max_length=10)
    place_name: str | None = Field(default=None, max_length=200)
    time_reference: str | None = Field(default=None, max_length=200)


class PointLabel(BaseModel):
    lat: float
    lng: float
    label: str | None
    source: LocationSource


class ConfirmedPoint(PointLabel):
    confirmed_at: str


class SubmittedPoint(BaseModel):
    lat: float
    lng: float


class Location(BaseModel):
    submitted_text: str | None
    submitted_point: SubmittedPoint | None
    suggested: PointLabel | None
    confirmed: ConfirmedPoint | None


class Sender(BaseModel):
    masked: str
    same_sender_count: int


class CallHelpline(BaseModel):
    number: str
    label: str | None


class CallInfo(BaseModel):
    helpline: CallHelpline | None = None
    duration_seconds: float | None
    has_audio: bool
    audio_url: str | None
    transcript_status: TranscriptStatus
    transcript_model: str | None
    transcript_error: str | None


class DuplicateSummary(BaseModel):
    created_at: str
    needs: list[NeedCategory]
    place: str | None
    status: ReportStatus


class DuplicateCandidate(BaseModel):
    report_id: str
    score: float
    reasons: list[str]
    summary: DuplicateSummary


class AuditEntry(BaseModel):
    at: str
    actor: str
    action: str
    from_status: str | None
    to_status: str | None
    note: str | None


class Report(BaseModel):
    id: str
    reference: str
    created_at: str
    updated_at: str
    is_synthetic: bool
    channel: Channel
    sender: Sender | None
    call: CallInfo | None
    source_text: str
    masked_text: str
    has_image: bool
    image_url: str | None
    extraction: Extraction
    reviewer_fields: ReviewerFields
    location: Location
    status: ReportStatus
    urgency: Urgency
    merged_into: str | None
    duplicate_count: int
    audit: list[AuditEntry]


class ReportListItem(BaseModel):
    id: str
    reference: str
    created_at: str
    is_synthetic: bool
    channel: Channel
    preview: str
    language: Language | None
    needs: list[NeedCategory]
    place: str | None
    extraction_status: ExtractionStatus
    transcript_status: TranscriptStatus | None
    status: ReportStatus
    urgency: Urgency
    duplicate_count: int
    has_confirmed_location: bool


class ReportList(BaseModel):
    items: list[ReportListItem]
    total: int
    page: int
    page_size: int


class PublicReport(BaseModel):
    id: str
    needs: list[NeedCategory]
    area_label: str
    lat: float
    lng: float
    approved_at: str
    is_synthetic: bool


class PublicReportList(BaseModel):
    items: list[PublicReport]
    total: int


class AreaCount(BaseModel):
    area_label: str
    count: int


class PublicStats(BaseModel):
    total_approved: int
    by_need: dict[str, int]
    by_area: list[AreaCount]


class ReviewerStats(BaseModel):
    by_status: dict[str, int]
    by_need: dict[str, int]
    by_extraction_status: dict[str, int]
    by_channel: dict[str, int]
    by_urgency: dict[str, int]


# ---------- requests and small responses ----------


class SubmitResponse(BaseModel):
    id: str
    reference: str
    status: ReportStatus


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class ReviewerResponse(BaseModel):
    reviewer: str


class HealthResponse(BaseModel):
    status: str
    model: str
    model_available: bool
    transcriber: str
    transcriber_available: bool
    map_provider: Literal["google", "osm"]
    demo_mode: bool


class OriginalResponse(BaseModel):
    source_text: str
    sender: str | None


class GeocodeCandidate(BaseModel):
    lat: float
    lng: float
    label: str
    type: str | None
    importance: float | None


class GeocodeResponse(BaseModel):
    candidates: list[GeocodeCandidate]


class LocationRequest(BaseModel):
    lat: float
    lng: float
    label: str | None = Field(default=None, max_length=200)
    source: Literal["geocoder_candidate", "reviewer_pin"]


class DuplicatesResponse(BaseModel):
    candidates: list[DuplicateCandidate]


class MergeRequest(BaseModel):
    target_id: str
    note: str | None = Field(default=None, max_length=500)


class ReviewRequest(BaseModel):
    action: ReviewAction | None = None  # omit to change urgency only
    urgency: Urgency | None = None
    note: str | None = Field(default=None, max_length=500)


class SimulatorRequest(BaseModel):
    channel: Literal["sms", "whatsapp"]
    from_: str = Field(alias="from", min_length=5, max_length=32)
    body: str = Field(min_length=1, max_length=5000)


class SimulatorResponse(BaseModel):
    report_id: str
    reference: str
    reply: str


class CallSimulatorResponse(SimulatorResponse):
    pass


class TranscriptRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class Category(BaseModel):
    key: str
    label: str
    label_ur: str | None
    keywords: list[str]
    builtin: bool
    active: bool
    created_at: str


class CategoryList(BaseModel):
    items: list[Category]


class CategoryCreate(BaseModel):
    label: str = Field(min_length=2, max_length=40)
    label_ur: str | None = Field(default=None, max_length=40)
    keywords: list[str] | None = Field(default=None, max_length=20)


class CategoryPatch(BaseModel):
    label: str | None = Field(default=None, min_length=2, max_length=40)
    label_ur: str | None = Field(default=None, max_length=40)
    keywords: list[str] | None = Field(default=None, max_length=20)
    active: bool | None = None


class Helpline(BaseModel):
    id: str
    number: str
    label: str
    provider_number: str | None
    active: bool
    created_at: str


class HelplineList(BaseModel):
    items: list[Helpline]


class PublicHelpline(BaseModel):
    number: str
    label: str


class PublicHelplineList(BaseModel):
    items: list[PublicHelpline]


_PHONE_PATTERN = r"^[+0-9][0-9 ()-]{6,24}$"


class HelplineCreate(BaseModel):
    number: str = Field(pattern=_PHONE_PATTERN)
    label: str = Field(min_length=2, max_length=60)
    provider_number: str | None = Field(default=None, pattern=_PHONE_PATTERN)


class HelplinePatch(BaseModel):
    label: str | None = Field(default=None, min_length=2, max_length=60)
    provider_number: str | None = Field(default=None, pattern=_PHONE_PATTERN)
    active: bool | None = None


class SmsGatewayStatus(BaseModel):
    configured: bool  # signing key set: forwarded SMS are accepted
    reply_enabled: bool
    has_credentials: bool  # gateway Cloud Server username/password in .env
    webhook_path: str
    last_received_at: str | None
    received_24h: int


class SmsGatewayRegister(BaseModel):
    public_url: str = Field(pattern=r"^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$", max_length=200)
    username: str | None = Field(default=None, max_length=100)
    password: str | None = Field(default=None, max_length=200)


class SmsGatewayRegistered(BaseModel):
    webhook_url: str
    webhook_id: str | None
    replaced: int


class PlaceSuggestion(BaseModel):
    label: str
    name: str
    lat: float | None
    lng: float | None


class PlaceSuggestResponse(BaseModel):
    provider: str
    items: list[PlaceSuggestion]
