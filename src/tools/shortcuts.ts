import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const ListShortcutsParams = z.object({})

export const listShortcuts: Tool<typeof ListShortcutsParams> = {
  name: 'list_shortcuts',
  description: 'List all available Apple Shortcuts on this Mac.',
  parameters: ListShortcutsParams,
  execute: async () => {
    try {
      const { stdout } = await execAsync('shortcuts list')
      return { success: true, result: stdout || 'No shortcuts found.' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const RunShortcutParams = z.object({
  name: z.string().min(1).describe('The exact name of the shortcut to run.'),
  input: z.string().optional().describe('Optional text input to pass to the shortcut.'),
})

export const runShortcut: Tool<typeof RunShortcutParams> = {
  name: 'run_shortcut',
  description: 'Execute an Apple Shortcut by name. Use list_shortcuts first to find available names.',
  parameters: RunShortcutParams,
  execute: async ({ name, input }) => {
    try {
      const command = input
        ? `echo ${JSON.stringify(input)} | shortcuts run "${name}"`
        : `shortcuts run "${name}"`

      const { stdout, stderr } = await execAsync(command)
      return {
        success: true,
        result: stdout || 'Shortcut executed successfully.',
        metadata: stderr ? { stderr } : undefined,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

toolRegistry.register(listShortcuts)
toolRegistry.register(runShortcut)
