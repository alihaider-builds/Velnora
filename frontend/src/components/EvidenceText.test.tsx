import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEMO_SENTENCE } from '../lib/demo'
import { EvidenceText } from './EvidenceText'

describe('EvidenceText', () => {
  it('highlights exactly the evidence phrase with an accessible name', () => {
    const { container } = render(
      <EvidenceText
        text={DEMO_SENTENCE}
        highlight={{ start: 60, end: 69, label: 'Evidence for Clean water' }}
      />,
    )
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('saaf pani')
    expect(marks[0].getAttribute('aria-label')).toBe('Evidence for Clean water')
    expect(container.textContent).toBe(DEMO_SENTENCE)
  })

  it('renders no highlight when there is none', () => {
    const { container } = render(<EvidenceText text={DEMO_SENTENCE} highlight={null} />)
    expect(container.querySelector('mark')).toBeNull()
  })

  it('marks Urdu text as RTL-capable Nastaliq', () => {
    const { container } = render(<EvidenceText text="بونیر میں پانی" highlight={null} />)
    const p = container.querySelector('p')!
    expect(p.getAttribute('dir')).toBe('auto')
    expect(p.getAttribute('lang')).toBe('ur')
    expect(p.className).toContain('urdu')
  })
})
