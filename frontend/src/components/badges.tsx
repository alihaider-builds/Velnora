import { BadgeCheck, FlaskConical, Sparkles } from 'lucide-react'
import type { Channel, Language, NeedCategory, PriorityLevel, ReportStatus } from '../api/types'
import { CHANNELS, LANGUAGE_LABEL, NEEDS, PRIORITY, STATUS } from '../lib/meta'

// Every badge pairs colour with an icon and a word — never colour alone (UI_UX_SPEC §1.6).

const pill =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap'

/** Filled pill, white text (§3.1a). */
export function PriorityBadge({ level, score }: { level: PriorityLevel; score?: number }) {
  const m = PRIORITY[level]
  const Icon = m.icon
  return (
    <span className={`${pill} text-white`} style={{ backgroundColor: m.color }}>
      <Icon size={13} aria-hidden="true" />
      {m.label}
      {score !== undefined && <span className="font-normal opacity-90">· {score}</span>}
    </span>
  )
}

/** Outlined pill, so status never looks like priority (§3.1a). */
export function StatusBadge({ status }: { status: ReportStatus }) {
  const m = STATUS[status]
  const Icon = m.icon
  return (
    <span className={`${pill} border bg-surface`} style={{ color: m.text, borderColor: m.color }}>
      <Icon size={13} aria-hidden="true" />
      {m.label}
    </span>
  )
}

export function ChannelBadge({
  channel,
  compact = false,
}: {
  channel: Channel
  compact?: boolean
}) {
  const m = CHANNELS[channel]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-text whitespace-nowrap">
      <Icon size={16} aria-hidden="true" className="text-muted" />
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>{m.label}</span>
    </span>
  )
}

export function NeedChip({
  need,
  bilingual = false,
  count,
}: {
  need: NeedCategory
  bilingual?: boolean
  count?: number
}) {
  const m = NEEDS[need]
  const Icon = m.icon
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-text whitespace-nowrap"
      style={{
        borderColor: `color-mix(in srgb, ${m.color} 45%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${m.color} 10%, var(--surface))`,
      }}
    >
      <Icon size={13} aria-hidden="true" style={{ color: m.color }} />
      {m.en}
      {bilingual && (
        <span
          lang="ur"
          dir="rtl"
          className="urdu text-muted"
          style={{ fontSize: '0.95em', lineHeight: 1.4 }}
        >
          {m.ur}
        </span>
      )}
      {count !== undefined && <span className="text-muted">{count}</span>}
    </span>
  )
}

export function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className={`${pill} border border-dashed border-ai bg-ai-soft text-ai`}>
      <Sparkles size={12} aria-hidden="true" />
      {label}
    </span>
  )
}

export function VerifiedBadge({ label = 'Verified by reviewer' }: { label?: string }) {
  return (
    <span className={`${pill} border border-verified bg-surface text-verified-ink`}>
      <BadgeCheck size={13} aria-hidden="true" />
      {label}
    </span>
  )
}

export function DemoTag() {
  return (
    <span className={`${pill} border border-banner-border bg-banner text-banner-text`}>
      <FlaskConical size={12} aria-hidden="true" />
      Demo data
    </span>
  )
}

export function LanguageBadge({ language }: { language: Language | null }) {
  if (!language) return null
  const label = LANGUAGE_LABEL[language]
  const isUrdu = language === 'urdu'
  return (
    <span
      className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
      lang={isUrdu ? 'ur' : undefined}
    >
      <span
        className={isUrdu ? 'urdu' : undefined}
        style={isUrdu ? { lineHeight: 1.4 } : undefined}
      >
        {label}
      </span>
    </span>
  )
}
