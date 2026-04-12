/**
 * Query-focused excerpts for bundled skill markdown to limit LLM context bloat.
 */

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'her',
  'was',
  'one',
  'our',
  'out',
  'day',
  'get',
  'has',
  'him',
  'his',
  'how',
  'its',
  'may',
  'new',
  'now',
  'old',
  'see',
  'two',
  'way',
  'who',
  'boy',
  'did',
  'let',
  'put',
  'say',
  'she',
  'too',
  'use',
])

export type ConsultDepth = 'minimal' | 'standard' | 'full'

export const DEPTH_BUDGETS: Record<ConsultDepth, { perFile: number; total: number; label: string }> = {
  minimal: {
    perFile: 1_200,
    total: 4_200,
    label: 'minimal (tight excerpts; lowest context cost)',
  },
  standard: {
    perFile: 2_400,
    total: 9_000,
    label: 'standard (balanced)',
  },
  full: {
    perFile: 4_800,
    total: 15_000,
    label: 'full (largest caps; highest context cost)',
  },
}

export function stripYamlFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return content
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) {
    return content
  }
  return trimmed.slice(end + 4).trimStart()
}

function tokenizeQuery(query: string): string[] {
  const out = new Set<string>()
  for (const raw of query.toLowerCase().split(/\W+/)) {
    const w = raw.trim()
    if (w.length < 3 || STOPWORDS.has(w)) {
      continue
    }
    out.add(w)
  }
  return [...out]
}

function scoreText(text: string, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0
  }
  const lower = text.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (lower.includes(t)) {
      score += 1
    }
  }
  return score
}

/**
 * Picks a subset of markdown in **document order**: preamble + `##` sections that match the query;
 * if nothing matches, falls back to the first few sections.
 */
export function pickMarkdownExcerpt(content: string, query: string, maxChars: number): string {
  const body = stripYamlFrontmatter(content)
  if (body.length <= maxChars) {
    return body
  }

  const tokens = tokenizeQuery(query)
  const sections = body.split(/\n(?=## )/)

  type Block = { index: number; text: string; score: number }
  const blocks: Block[] = sections.map((raw, index) => {
    const text = index === 0 ? raw : raw.startsWith('##') ? raw : `## ${raw}`
    const score = scoreText(raw, tokens) + (index === 0 ? 0.5 : 0)
    return { index, text, score }
  })

  const chosen = new Set<number>()
  chosen.add(0)
  if (tokens.length === 0) {
    for (let i = 1; i < Math.min(blocks.length, 4); i++) {
      chosen.add(i)
    }
  } else {
    const hits = blocks.filter((b) => b.score >= 1)
    if (hits.length > 0) {
      for (const h of hits) {
        chosen.add(h.index)
      }
    } else {
      for (let i = 1; i < Math.min(blocks.length, 3); i++) {
        chosen.add(i)
      }
    }
  }

  let assembled = ''
  for (const b of blocks.filter((x) => chosen.has(x.index)).sort((a, c) => a.index - c.index)) {
    if (assembled.length >= maxChars) {
      break
    }
    const sep = assembled.length > 0 ? '\n\n' : ''
    const remaining = maxChars - assembled.length - sep.length
    if (remaining <= 0) {
      break
    }
    let piece = `${sep}${b.text}`
    if (piece.length > remaining) {
      assembled += piece.slice(0, remaining)
      assembled += '\n… (truncated)'
      break
    }
    assembled += piece
  }

  const out = assembled.trim()
  if (out.length > 0) {
    return out
  }

  return `${body.slice(0, maxChars)}\n… (truncated)`
}

/** Hard cap on the final assembled consult string (all files + headers). */
export function applyTotalCap(text: string, maxTotal: number): string {
  if (text.length <= maxTotal) {
    return text
  }
  return `${text.slice(0, Math.max(400, maxTotal - 120))}\n\n… (global cap: total consult output truncated for context budget)`
}
