import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { MacSandbox } from '../sandbox/MacSandbox'
import { recordEnergyImpact } from '../utils/energyImpact'

const ExecuteSecureCodeParams = z.object({
  language: z.enum(['javascript', 'python']).describe('Runtime to use for execution.'),
  code: z.string().min(1).describe('The code to execute inside the sandbox.'),
})

export const executeSecureCode: Tool<typeof ExecuteSecureCodeParams> = {
  name: 'execute_secure_code',
  description:
    'Executes code in a hardened, native macOS sandbox. It has NO network or file access. Use this for math, cleaning JSON, or running logic-heavy scripts.',
  parameters: ExecuteSecureCodeParams,
  execute: async ({ language, code }) => {
    try {
      recordEnergyImpact('native_sandbox_run')
      const sandbox = new MacSandbox()
      const result = await sandbox.runCode(language, code)
      if (result.error && result.error.trim().length > 0) {
        // Keep the error clean so the agent can iterate quickly.
        const clean = result.error.trim().split('\n').slice(0, 40).join('\n')
        return {
          success: false,
          error: clean,
          data: result,
        }
      }

      return { success: true, result: result.output, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message ?? String(error) }
    }
  },
}

toolRegistry.register(executeSecureCode)
