import type { ElementType, ReactNode } from 'react'
import { hasUrduScript } from '../lib/text'

/**
 * Wraps submitter-written text: dir="auto" so the browser picks the direction, plus lang="ur"
 * and the Nastaliq font when the text contains Urdu script (UI_UX_SPEC §3.5, §7).
 */
export function UserText({
  text,
  as: Tag = 'span',
  className = '',
  children,
  id,
}: {
  text: string
  as?: ElementType
  className?: string
  children?: ReactNode
  id?: string
}) {
  const urdu = hasUrduScript(text)
  return (
    <Tag
      id={id}
      dir="auto"
      lang={urdu ? 'ur' : undefined}
      className={`${urdu ? 'urdu' : ''} ${className}`}
    >
      {children ?? text}
    </Tag>
  )
}
