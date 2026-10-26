import {
  CheckCircle2,
  CircleHelp,
  Clock,
  Droplet,
  Flag,
  GitMerge,
  Globe,
  Home,
  MessageCircle,
  MessageSquare,
  Phone,
  Pill,
  Tag,
  Truck,
  Utensils,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type {
  BuiltinNeed,
  Category,
  Channel,
  Language,
  NeedCategory,
  ReportStatus,
  Urgency,
} from '../api/types'

// One source for labels, icons and colours — UI_UX_SPEC §3.1a, §3.2.

export interface NeedMeta {
  en: string
  ur: string
  icon: LucideIcon
  color: string
}

/** Icons and colours for the six built-in categories; labels can be renamed by the organizer. */
export const NEEDS: Record<BuiltinNeed, NeedMeta> = {
  food: { en: 'Food', ur: 'خوراک', icon: Utensils, color: 'var(--need-food)' },
  clean_water: {
    en: 'Clean water',
    ur: 'صاف پانی',
    icon: Droplet,
    color: 'var(--need-clean_water)',
  },
  shelter: { en: 'Shelter', ur: 'پناہ', icon: Home, color: 'var(--need-shelter)' },
  medicine: { en: 'Medicine', ur: 'دوا', icon: Pill, color: 'var(--need-medicine)' },
  evacuation: { en: 'Evacuation', ur: 'انخلا', icon: Truck, color: 'var(--need-evacuation)' },
  other: { en: 'Other', ur: 'دیگر', icon: CircleHelp, color: 'var(--need-other)' },
}

/** Display order of built-ins — matches the validated colour sequence in styles/tokens.css. */
export const NEED_ORDER: BuiltinNeed[] = [
  'clean_water',
  'evacuation',
  'shelter',
  'food',
  'medicine',
  'other',
]

function prettify(key: string): string {
  const s = key.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

/** Label, icon and colour for any category key: built-ins keep their icon and colour,
 * organizer-added ones get a generic tag icon. Labels come from the live category list. */
export function needMeta(key: NeedCategory, categories?: Category[]): NeedMeta {
  const cat = categories?.find((c) => c.key === key)
  const builtin = (NEEDS as Record<string, NeedMeta | undefined>)[key]
  return {
    en: cat?.label ?? builtin?.en ?? prettify(key),
    ur: cat?.label_ur ?? builtin?.ur ?? '',
    icon: builtin?.icon ?? Tag,
    color: builtin?.color ?? 'var(--need-other)',
  }
}

/** Active categories in display order: built-ins first (colour order), then custom ones. */
export function needOrder(categories?: Category[]): NeedCategory[] {
  if (!categories) return NEED_ORDER
  const active = categories.filter((c) => c.active).map((c) => c.key)
  const builtins = NEED_ORDER.filter((k) => active.includes(k))
  return [...builtins, ...active.filter((k) => !(NEED_ORDER as string[]).includes(k))]
}

export const CHANNELS: Record<Channel, { label: string; icon: LucideIcon }> = {
  web: { label: 'Web form', icon: Globe },
  sms: { label: 'SMS', icon: MessageSquare },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  call: { label: 'Call', icon: Phone },
}

export const CHANNEL_ORDER: Channel[] = ['web', 'sms', 'whatsapp', 'call']

/** `color` for borders and icons; `text` for small text (>= 4.5:1 on light surfaces). */
export const STATUS: Record<
  ReportStatus,
  { label: string; icon: LucideIcon; color: string; text: string }
> = {
  pending_review: {
    label: 'Pending',
    icon: Clock,
    color: 'var(--pending)',
    text: 'var(--pending-ink)',
  },
  flagged: { label: 'Flagged', icon: Flag, color: 'var(--flagged)', text: 'var(--flagged)' },
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    color: 'var(--verified)',
    text: 'var(--verified-ink)',
  },
  rejected: { label: 'Rejected', icon: XCircle, color: 'var(--rejected)', text: 'var(--rejected)' },
  merged: { label: 'Merged', icon: GitMerge, color: 'var(--merged)', text: 'var(--merged)' },
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  roman_urdu: 'Roman Urdu',
  urdu: 'اردو',
  english: 'English',
  pashto: 'Pashto (experimental)',
  mixed: 'Mixed',
  unknown: 'Unknown language',
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  unknown: 'Unknown',
}
