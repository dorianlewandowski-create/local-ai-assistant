import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from '../../tools/registry'
import path from 'path'
import fs from 'fs/promises'
import { applyTotalCap, DEPTH_BUDGETS, pickMarkdownExcerpt, type ConsultDepth } from './excerpt'

const ConsultParams = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'The analytical question or task (e.g., "How should I design this A/B test?", "Look for anomalies in my body battery data").',
    ),
  depth: z
    .enum(['minimal', 'standard', 'full'])
    .optional()
    .describe(
      'How much reference text to load: minimal (smallest context), standard (default), full (largest; highest token cost). Prefer minimal unless the question needs deep methodology text.',
    ),
})

const SKILL_DIR = path.join(process.cwd(), 'src', 'skills', 'data-analysis')

async function readUtf8(file: string): Promise<string> {
  const p = path.join(SKILL_DIR, file)
  return await fs.readFile(p, 'utf8')
}

export const dataAnalysisConsult: Tool<typeof ConsultParams> = {
  name: 'data_analysis_consult',
  description:
    'Load data-analysis skill references (methodology, techniques, charts) for the given question. Uses query-focused excerpts and depth to limit context size — prefer depth=minimal when possible.',
  parameters: ConsultParams,
  execute: async ({ query, depth }: { query: string; depth?: ConsultDepth }) => {
    try {
      const d: ConsultDepth = depth ?? 'standard'
      const budget = DEPTH_BUDGETS[d]

      const [skillRaw, techniquesRaw, chartsRaw] = await Promise.all([
        readUtf8('SKILL.md'),
        readUtf8('techniques.md'),
        readUtf8('chart-selection.md'),
      ])

      const skill = pickMarkdownExcerpt(skillRaw, query, budget.perFile)
      const techniques = pickMarkdownExcerpt(techniquesRaw, query, budget.perFile)
      const charts = pickMarkdownExcerpt(chartsRaw, query, budget.perFile)

      const body = [
        `Data analysis context for: "${query}"`,
        `(depth=${d}: ${budget.label}; per-file excerpt cap ≈ ${budget.perFile} chars, total cap ≈ ${budget.total} chars)`,
        '',
        '--- SKILL.md ---',
        skill,
        '',
        '--- techniques.md ---',
        techniques,
        '',
        '--- chart-selection.md ---',
        charts,
      ].join('\n')

      const capped = applyTotalCap(body, budget.total)

      return {
        success: true,
        result: capped,
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Could not read data-analysis skill files under ${SKILL_DIR}: ${error?.message ?? error}`,
      }
    }
  },
}

toolRegistry.register(dataAnalysisConsult)
