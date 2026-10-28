export interface DiffPart {
  text: string
  kind: 'same' | 'ins' | 'del'
}

const MAX_TOKENS = 900

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? []
}

function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = []
  for (const part of parts) {
    if (!part.text) continue
    const last = merged[merged.length - 1]
    if (last && last.kind === part.kind) last.text += part.text
    else merged.push({ ...part })
  }
  return merged
}

function lcs(a: string[], b: string[]): DiffPart[] {
  const table: Uint16Array[] = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ text: a[i], kind: 'same' })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      parts.push({ text: a[i], kind: 'del' })
      i += 1
    } else {
      parts.push({ text: b[j], kind: 'ins' })
      j += 1
    }
  }
  while (i < a.length) {
    parts.push({ text: a[i], kind: 'del' })
    i += 1
  }
  while (j < b.length) {
    parts.push({ text: b[j], kind: 'ins' })
    j += 1
  }
  return parts
}

/**
 * A compact word diff. The unchanged prefix and suffix are skipped so typing a
 * character in a long paragraph only runs LCS on the small changed middle.
 */
export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return after ? [{ text: after, kind: 'same' }] : []

  let start = 0
  const shortest = Math.min(before.length, after.length)
  while (start < shortest && before[start] === after[start]) start += 1

  let beforeEnd = before.length
  let afterEnd = after.length
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  const prefix = before.slice(0, start)
  const suffix = before.slice(beforeEnd)
  const a = tokenize(before.slice(start, beforeEnd))
  const b = tokenize(after.slice(start, afterEnd))

  const parts: DiffPart[] = []
  if (prefix) parts.push({ text: prefix, kind: 'same' })
  if (a.length * b.length > MAX_TOKENS * MAX_TOKENS) {
    if (a.length) parts.push({ text: a.join(''), kind: 'del' })
    if (b.length) parts.push({ text: b.join(''), kind: 'ins' })
  } else {
    parts.push(...lcs(a, b))
  }
  if (suffix) parts.push({ text: suffix, kind: 'same' })
  return merge(parts)
}
