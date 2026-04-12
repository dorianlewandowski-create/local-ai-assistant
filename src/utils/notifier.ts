import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface NotificationInput {
  message: string
  title?: string
  subtitle?: string
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function sendNotification({
  message,
  title = 'Apex',
  subtitle = 'Action taken',
}: NotificationInput): Promise<void> {
  const script = `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}" subtitle "${escapeAppleScriptString(subtitle)}"`
  await execAsync(`osascript -e ${JSON.stringify(script)}`)
}
