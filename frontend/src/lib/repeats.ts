// Whisper sometimes gets stuck and repeats the same word or phrase dozens of times ("پر پر پر …"),
// especially on noise or long pauses. Runs of one to four words repeated three or more times in a
// row are collapsed to a single copy, so the reporter never gets a page of garbage to delete.
// Genuine doubling ("pani pani", "jaldi jaldi") is kept.

const MAX_PHRASE = 4
const MIN_RUN = 3

export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let skipped = false
    for (let n = 1; n <= MAX_PHRASE; n++) {
      if (i + n * MIN_RUN > words.length) continue
      const phrase = words.slice(i, i + n).join(' ')
      let runs = 1
      while (words.slice(i + runs * n, i + (runs + 1) * n).join(' ') === phrase) runs++
      if (runs >= MIN_RUN) {
        out.push(...words.slice(i, i + n))
        i += runs * n
        skipped = true
        break
      }
    }
    if (!skipped) out.push(words[i++])
  }
  return out.join(' ')
}
