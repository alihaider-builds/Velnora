// Mirrors BACKEND_TECH_SPEC.md §4 exactly. Never add fields here that the contract lacks.

// §4.2 Enumerations
/** Category key from GET /api/categories — built-ins plus ones the organizer adds. */
export type NeedCategory = string
export type BuiltinNeed = 'food' | 'clean_water' | 'shelter' | 'medicine' | 'evacuation' | 'other'
export type Urgency = 'low' | 'medium' | 'high' | 'unknown'
export type ReportStatus = 'pending_review' | 'approved' | 'rejected' | 'flagged' | 'merged'
export type ExtractionStatus = 'pending' | 'running' | 'succeeded' | 'failed'
export type Language = 'roman_urdu' | 'urdu' | 'english' | 'pashto' | 'mixed' | 'unknown'
export type LocationSource = 'submitter_pin' | 'geocoder_candidate' | 'reviewer_pin'
export type ReviewAction = 'approve' | 'reject' | 'flag' | 'reopen'
export type Channel = 'web' | 'sms' | 'whatsapp' | 'call'
export type TranscriptStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'manual'

/** §4.1 — error body for every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details: Record<string, unknown>
  }
}

// §4.3 Shared objects

/** `start`/`end` are Unicode code-point offsets into `source_text`, end-exclusive. */
export interface Evidence {
  phrase: string
  start: number | null
  end: number | null
  matched: boolean
}

export interface ExtractedNeed {
  category: NeedCategory
  evidence: Evidence
}

export interface ExtractedQuantity {
  value: number
  label: string
  evidence: Evidence
}

export interface ExtractedText {
  text: string
  evidence: Evidence
}

export interface Extraction {
  status: ExtractionStatus
  model: string
  attempts: number
  completed_at: string | null
  error: string | null
  language: Language | null
  needs: ExtractedNeed[]
  quantities: ExtractedQuantity[]
  place_name: ExtractedText | null
  time_reference: ExtractedText | null
  uncertainties: string[]
}

export interface ReviewerQuantity {
  value: number
  label: string
}

/** Reviewer corrections; `null` = no correction, use the AI value. */
export interface ReviewerFields {
  needs: NeedCategory[] | null
  quantities: ReviewerQuantity[] | null
  place_name: string | null
  time_reference: string | null
}

export interface LatLng {
  lat: number
  lng: number
}

export interface SuggestedLocation extends LatLng {
  label: string
  source: LocationSource
}

export interface ConfirmedLocation extends SuggestedLocation {
  confirmed_at: string
}

export interface Location {
  submitted_text: string | null
  submitted_point: LatLng | null
  suggested: SuggestedLocation | null
  confirmed: ConfirmedLocation | null
}

export interface DuplicateCandidate {
  report_id: string
  score: number
  reasons: string[]
  summary: {
    created_at: string
    needs: NeedCategory[]
    place: string | null
    status: ReportStatus
  }
}

export interface Sender {
  masked: string
  same_sender_count: number
}

/** Present only on call reports. */
export interface CallHelpline {
  number: string
  label: string | null
}

export interface CallInfo {
  /** Which helpline the call came in on; null when it didn't match a registered one. */
  helpline: CallHelpline | null
  duration_seconds: number | null
  has_audio: boolean
  audio_url: string | null
  transcript_status: TranscriptStatus
  transcript_model: string | null
  transcript_error: string | null
}

export interface Category {
  key: NeedCategory
  label: string
  label_ur: string | null
  keywords: string[]
  builtin: boolean
  active: boolean
  created_at: string
}

export interface AuditEntry {
  at: string
  actor: string
  action: string
  from_status: ReportStatus | null
  to_status: ReportStatus | null
  note: string | null
}

/** Reviewer view of a report. */
export interface Report {
  id: string
  reference: string
  created_at: string
  updated_at: string
  is_synthetic: boolean
  channel: Channel
  sender: Sender | null
  call: CallInfo | null
  source_text: string
  masked_text: string
  has_image: boolean
  image_url: string | null
  extraction: Extraction
  reviewer_fields: ReviewerFields
  location: Location
  status: ReportStatus
  urgency: Urgency
  merged_into: string | null
  duplicate_count: number
  audit: AuditEntry[]
}

/** Queue rows. */
export interface ReportListItem {
  id: string
  reference: string
  created_at: string
  is_synthetic: boolean
  channel: Channel
  preview: string
  language: Language | null
  needs: NeedCategory[]
  place: string | null
  extraction_status: ExtractionStatus
  transcript_status: TranscriptStatus | null
  status: ReportStatus
  urgency: Urgency
  duplicate_count: number
  has_confirmed_location: boolean
}

/** Privacy-filtered — the only shape the public ever sees. */
export interface PublicReport {
  id: string
  needs: NeedCategory[]
  area_label: string
  lat: number
  lng: number
  approved_at: string
  is_synthetic: boolean
}

// §4.4 Endpoint payloads

export interface HealthResponse {
  status: string
  model: string
  model_available: boolean
  transcriber: string
  transcriber_available: boolean
  map_provider: 'google' | 'osm'
  demo_mode: boolean
}

export interface ReviewerResponse {
  reviewer: string
}

export interface CreateReportResponse {
  id: string
  reference: string
  status: ReportStatus
}

export interface SimulatorSendRequest {
  channel: 'sms' | 'whatsapp'
  from: string
  body: string
}

export interface SimulatorSendResponse {
  report_id: string
  reference: string
  reply: string
}

export type ReportSort = 'newest' | 'oldest'

export interface ReportListParams {
  status?: ReportStatus[]
  need?: NeedCategory
  channel?: Channel[]
  urgency?: Urgency[]
  extraction_status?: ExtractionStatus
  q?: string
  sort?: ReportSort
  page?: number
  page_size?: number
}

export interface ReportListResponse {
  items: ReportListItem[]
  total: number
  page: number
  page_size: number
}

export interface OriginalResponse {
  source_text: string
  sender: string | null
}

export interface GeocodeCandidate extends LatLng {
  label: string
  type: string
  importance: number
}

export interface GeocodeResponse {
  candidates: GeocodeCandidate[]
}

export interface ConfirmLocationRequest extends LatLng {
  label: string
  source: 'geocoder_candidate' | 'reviewer_pin'
}

export interface DuplicatesResponse {
  candidates: DuplicateCandidate[]
}

export interface MergeRequest {
  target_id: string
  note?: string
}

/** Omit `action` to change urgency only. */
export interface ReviewRequest {
  action?: ReviewAction
  urgency?: Urgency
  note?: string
}

export interface PublicReportsResponse {
  items: PublicReport[]
  total: number
}

export interface PublicStats {
  total_approved: number
  by_need: Partial<Record<NeedCategory, number>>
  by_area: { area_label: string; count: number }[]
}

export interface ReviewerStats {
  by_status: Partial<Record<ReportStatus, number>>
  by_need: Partial<Record<NeedCategory, number>>
  by_extraction_status: Partial<Record<ExtractionStatus, number>>
  by_channel: Partial<Record<Channel, number>>
  by_urgency: Partial<Record<Urgency, number>>
}

export interface CategoryListResponse {
  items: Category[]
}

export interface CategoryCreateRequest {
  label: string
  label_ur?: string
  keywords?: string[]
}

export interface CategoryPatchRequest {
  label?: string
  label_ur?: string | null
  keywords?: string[]
  active?: boolean
}

export interface TranscriptRequest {
  text: string
}

export interface Helpline {
  id: string
  number: string
  label: string
  provider_number: string | null
  active: boolean
  created_at: string
}

export interface HelplineListResponse {
  items: Helpline[]
}

export interface PublicHelpline {
  number: string
  label: string
}

export interface PublicHelplineListResponse {
  items: PublicHelpline[]
}

export interface HelplineCreateRequest {
  number: string
  label: string
  provider_number?: string
}

export interface HelplinePatchRequest {
  label?: string
  provider_number?: string | null
  active?: boolean
}

export interface PlaceSuggestion {
  label: string
  name: string
  /** Google suggestions have no coordinates; OpenStreetMap ones do. */
  lat: number | null
  lng: number | null
}

export interface PlaceSuggestResponse {
  provider: 'google' | 'osm'
  items: PlaceSuggestion[]
}

export interface SmsGatewayStatus {
  /** Signing key set on the server: forwarded SMS are accepted. */
  configured: boolean
  reply_enabled: boolean
  has_credentials: boolean
  webhook_path: string
  last_received_at: string | null
  received_24h: number
  textbee_configured: boolean
  textbee_has_api_key: boolean
  textbee_reply_enabled: boolean
}

export interface TextbeeRegisterRequest {
  public_url: string
  api_key?: string
}

export interface SmsGatewayRegisterRequest {
  public_url: string
  username?: string
  password?: string
}

export interface SmsGatewayRegistered {
  webhook_url: string
  webhook_id: string | null
  replaced: number
}
