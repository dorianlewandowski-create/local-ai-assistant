import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from '../../tools/registry'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)
const SKILL_DIR = path.join(process.cwd(), 'src', 'skills', 'tech-news')

const RunPipelineParams = z.object({
  hours: z.number().default(24).describe('How many hours of news to fetch.'),
})

export const runNewsPipeline: Tool<typeof RunPipelineParams> = {
  name: 'generate_tech_news_digest',
  description: 'Run the technical news pipeline to fetch, score, and deduplicate news from 150+ sources.',
  parameters: RunPipelineParams,
  execute: async ({ hours }: { hours: number }) => {
    try {
      const outputJson = '/tmp/td-merged.json'
      const command = `python3 "${path.join(SKILL_DIR, 'scripts', 'run-pipeline.py')}" --defaults "${path.join(SKILL_DIR, 'config', 'defaults')}" --hours ${hours} --output ${outputJson} --verbose --force`

      const { stdout } = await execAsync(command)

      // Also generate a summary for the LLM to read easily
      const { stdout: summary } = await execAsync(
        `python3 "${path.join(SKILL_DIR, 'scripts', 'summarize-merged.py')}" --input ${outputJson} --top 10`,
      )

      return {
        success: true,
        result: `Pipeline finished successfully.\n\nSummary of Top News:\n${summary}`,
        metadata: { outputJson },
      }
    } catch (error: any) {
      return {
        success: false,
        error: `News pipeline failed. Ensure Python dependencies are installed. Error: ${error.message}`,
      }
    }
  },
}

const ReadSummaryParams = z.object({})

export const readNewsSummary: Tool<typeof ReadSummaryParams> = {
  name: 'read_latest_tech_news',
  description: 'Read the top 10 news items from the last generated digest.',
  parameters: ReadSummaryParams,
  execute: async () => {
    try {
      const inputJson = '/tmp/td-merged.json'
      const { stdout: summary } = await execAsync(
        `python3 "${path.join(SKILL_DIR, 'scripts', 'summarize-merged.py')}" --input ${inputJson} --top 10`,
      )
      return { success: true, result: summary }
    } catch (error: any) {
      return { success: false, error: 'No news digest found. Run generate_tech_news_digest first.' }
    }
  },
}

toolRegistry.register(runNewsPipeline)
toolRegistry.register(readNewsSummary)
