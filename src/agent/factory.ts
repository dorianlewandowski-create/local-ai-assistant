import type { AgentConfig, SubAgentKind } from '@apex/types'
import { filterToolsForSubAgentKind } from './subAgentToolPolicy'

const SHARED_AGENT_RULES =
  'Use tools deliberately. Be concise and safe. Fix tool errors and retry. End with Finished:.'

/** Multi-word and phrase hints (substring match, lowercased). */
const CODER_PHRASES = [
  'file content',
  'pull request',
  'unit test',
  'typescript',
  'javascript',
  'stack trace',
  'npm ',
  'pnpm ',
  'eslint',
]

const RESEARCHER_PHRASES = ['summarize', 'summary', 'investigate', 'literature review']

/** Single-token hints matched with word boundaries where possible. */
const CODER_WORDS = [
  'refactor',
  'debug',
  'build',
  'patch',
  'repository',
  'repo',
  'compile',
  'code',
  'fix',
  'test',
  'jest',
  'vitest',
  'webpack',
  'esbuild',
]

const RESEARCHER_WORDS = [
  'research',
  'analyze',
  'pdf',
  'weather',
  'context',
  'memory',
  'fact',
  'read',
  'image',
  'compare',
  'sources',
  'citations',
]

export type RoutingSource = 'override' | 'heuristic'
export type RoutingConfidence = 'high' | 'medium' | 'low'

export interface RoutingDecision {
  kind: SubAgentKind
  source: RoutingSource
  coderScore: number
  researcherScore: number
  confidence: RoutingConfidence
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreHints(text: string, phrases: string[], words: string[]): number {
  const t = text.toLowerCase()
  let score = 0
  for (const phrase of phrases) {
    if (phrase.length >= 2 && t.includes(phrase.toLowerCase())) {
      score += phrase.includes(' ') ? 2 : 1
    }
  }
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRegExp(w.toLowerCase())}\\b`, 'i')
    if (re.test(t)) {
      score += 1
    }
  }
  return score
}

function heuristicKindFromScores(
  coderScore: number,
  researcherScore: number,
): {
  kind: SubAgentKind
  confidence: RoutingConfidence
} {
  if (coderScore === 0 && researcherScore === 0) {
    return { kind: 'system', confidence: 'high' }
  }
  /** Ties with both sides scoring: prefer coder (matches legacy regex order: code branch before research). */
  if (coderScore === researcherScore && coderScore > 0) {
    return { kind: 'coder', confidence: 'low' }
  }

  const winner = coderScore > researcherScore ? 'coder' : 'researcher'
  const hi = Math.max(coderScore, researcherScore)
  const lo = Math.min(coderScore, researcherScore)

  if (lo === 0) {
    return { kind: winner, confidence: hi >= 2 ? 'high' : 'medium' }
  }
  const gap = hi - lo
  if (gap >= 2) {
    return { kind: winner, confidence: 'high' }
  }
  if (gap === 1) {
    return { kind: winner, confidence: 'medium' }
  }
  return { kind: 'system', confidence: 'low' }
}

export class AgentFactory {
  constructor(
    private readonly model: string,
    private readonly tools: string[],
  ) {}

  create(kind: SubAgentKind): AgentConfig {
    const resolvedTools = filterToolsForSubAgentKind(kind, this.tools)
    switch (kind) {
      case 'researcher':
        return {
          name: 'Researcher Agent',
          model: this.model,
          tools: resolvedTools,
          systemPrompt: `${SHARED_AGENT_RULES} Researcher: gather context, read/search, consult memory, synthesize evidence. Your tool access is read-oriented (no OS automation or destructive tools); use approved memory/consult tools when needed.`,
        }
      case 'coder':
        return {
          name: 'Coder Agent',
          model: this.model,
          tools: resolvedTools,
          systemPrompt: `${SHARED_AGENT_RULES} Coder: inspect, edit, debug, and execute technical tasks directly.`,
        }
      case 'system':
      default:
        return {
          name: 'System Agent',
          model: this.model,
          tools: resolvedTools,
          systemPrompt: `${SHARED_AGENT_RULES} System: you are now a macOS Power User. Handle OS actions, AppleScript UI control, notifications, schedule-aware help, monitoring, and device operations. Before suggesting meetings or availability, you MUST call get_today_schedule. If a task needs UI interaction (Spotify, Settings, Finder), write precise AppleScript and execute it. For Spotify: use play_spotify_track only with an exact Spotify URI; otherwise use play_spotify_search for artist or plain-language requests. Only claim music is playing if the tool output explicitly confirms played:true or says Playing .... Always inform the user what you are about to do.`,
        }
    }
  }

  chooseWithDiagnostics(prompt: string, metadata?: Record<string, unknown>): RoutingDecision {
    const direct = metadata?.subAgentKind
    if (direct === 'researcher' || direct === 'coder' || direct === 'system') {
      return {
        kind: direct,
        source: 'override',
        coderScore: 0,
        researcherScore: 0,
        confidence: 'high',
      }
    }

    const combined = `${prompt} ${JSON.stringify(metadata ?? {})}`
    const coderScore = scoreHints(combined, CODER_PHRASES, CODER_WORDS)
    const researcherScore = scoreHints(combined, RESEARCHER_PHRASES, RESEARCHER_WORDS)
    const { kind, confidence } = heuristicKindFromScores(coderScore, researcherScore)

    return {
      kind,
      source: 'heuristic',
      coderScore,
      researcherScore,
      confidence,
    }
  }

  choose(prompt: string, metadata?: Record<string, unknown>): SubAgentKind {
    return this.chooseWithDiagnostics(prompt, metadata).kind
  }
}
