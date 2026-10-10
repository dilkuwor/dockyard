/** A small unified line diff, enough for compose files. Longest-common-subsequence based. */
function diffLines(before: string, after: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Renders the diff with unchanged context trimmed to a few lines around each change. */
export default function LineDiff({ before, after, context = 3 }: { before: string; after: string; context?: number }) {
  const lines = diffLines(before, after)
  const keep = new Set<number>()
  lines.forEach((l, idx) => {
    if (l.type === 'same') return
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep.add(k)
  })
  const rows: ({ type: 'same' | 'add' | 'del'; text: string } | { type: 'gap'; count: number })[] = []
  let gap = 0
  lines.forEach((l, idx) => {
    if (keep.has(idx)) {
      if (gap) rows.push({ type: 'gap', count: gap })
      gap = 0
      rows.push(l)
    } else {
      gap++
    }
  })
  if (gap) rows.push({ type: 'gap', count: gap })

  return (
    <pre className="overflow-auto rounded-md border border-rule bg-paper font-mono text-xs leading-relaxed">
      {rows.map((r, idx) =>
        r.type === 'gap' ? (
          <div key={idx} className="px-3 py-0.5 text-ink-soft/60 select-none">
            ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
          </div>
        ) : (
          <div
            key={idx}
            className={
              r.type === 'add'
                ? 'bg-starboard/10 px-3 text-starboard'
                : r.type === 'del'
                  ? 'bg-port/10 px-3 text-port'
                  : 'px-3 text-ink-soft'
            }
          >
            <span className="mr-2 inline-block w-3 select-none">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
            {r.text}
          </div>
        ),
      )}
    </pre>
  )
}
