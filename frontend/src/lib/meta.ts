import {
  ArrowDown,
  ArrowUp,
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
  Minus,
  Pill,
  Siren,
  Truck,
  Utensils,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type {
  Channel,
  Language,
  NeedCategory,
  PriorityLevel,
  ReportStatus,
  Urgency,
} from '../api/types'

// One source for labels, icons and colours — UI_UX_SPEC §3.1a, §3.2.

export const NEEDS: Record<
  NeedCategory,
  { en: string; ur: string; icon: LucideIcon; color: string }
> = {
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

/** Display order — matches the validated colour sequence in styles/tokens.css. */
export const NEED_ORDER: NeedCategory[] = [
  'clean_water',
  'evacuation',
  'shelter',
  'food',
  'medicine',
  'other',
]

export const PRIORITY: Record<PriorityLevel, { label: string; icon: LucideIcon; color: string }> = {
  critical: { label: 'Critical', icon: Siren, color: 'var(--p-critical)' },
  high: { label: 'High', icon: ArrowUp, color: 'var(--p-high)' },
  medium: { label: 'Medium', icon: Minus, color: 'var(--p-medium)' },
  low: { label: 'Low', icon: ArrowDown, color: 'var(--p-low)' },
}

export const PRIORITY_ORDER: PriorityLevel[] = ['critical', 'high', 'medium', 'low']

export const CHANNELS: Record<Channel, { label: string; icon: LucideIcon }> = {
  web: { label: 'Web form', icon: Globe },
  sms: { label: 'SMS', icon: MessageSquare },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
}

export const CHANNEL_ORDER: Channel[] = ['web', 'sms', 'whatsapp']

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
