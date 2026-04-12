import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from '../../tools/registry'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)
const SKILL_DIR = path.join(process.cwd(), 'src', 'skills', 'web-search-plus')

const WebSearchPlusParams = z.object({
  query: z.string().min(1).describe('The search query.'),
  provider: z
    .enum(['auto', 'serper', 'tavily', 'querit', 'exa', 'perplexity', 'you', 'searxng'])
    .default('auto')
    .describe('Specific provider to use or "auto" for intelligent routing.'),
  max_results: z.number().default(5).describe('Maximum number of results to return.'),
  explain_routing: z
    .boolean()
    .default(false)
    .describe('If true, explains why a specific provider was chosen.'),
})

type WebSearchPlusArgs = {
  query: string
  provider: 'auto' | 'serper' | 'tavily' | 'querit' | 'exa' | 'perplexity' | 'you' | 'searxng'
  max_results: number
  explain_routing: boolean
}

export const webSearchPlus: Tool<typeof WebSearchPlusParams> = {
  name: 'web_search_plus',
  description:
    'Advanced web search with intelligent auto-routing between 7+ providers (Google, Research, Neural, AI Answers). Use this as your primary search tool for the most accurate and relevant results.',
  parameters: WebSearchPlusParams,
  execute: async ({ query, provider, max_results, explain_routing }: WebSearchPlusArgs) => {
    try {
      let command = `python3 "${path.join(SKILL_DIR, 'scripts', 'search.py')}" -q "${query.replace(/"/g, '\\"')}" -n ${max_results}`

      if (provider !== 'auto') {
        command += ` -p ${provider}`
      }

      if (explain_routing) {
        command += ` --explain-routing`
      }

      const { stdout } = await execAsync(command)

      try {
        // Try to parse JSON output if the script returns it
        const parsed = JSON.parse(stdout)
        return { success: true, result: JSON.stringify(parsed, null, 2) }
      } catch {
        // Fallback to raw text
        return { success: true, result: stdout }
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Web Search Plus failed. Ensure Python dependencies are installed and API keys are set in .env. Error: ${error.message}`,
      }
    }
  },
}

toolRegistry.register(webSearchPlus)
