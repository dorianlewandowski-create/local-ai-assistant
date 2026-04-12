import { getVectorStore } from '../db/vectorStore'

/**
 * Build status lines for gateway /status commands.
 *
 * The uptime/battery providers are async to avoid blocking the event loop.
 */
export async function getGatewayStatusLines(
  getSystemUptime: () => Promise<string>,
  getBatteryLevel: () => Promise<string>,
): Promise<string[]> {
  const memoryCount = await getVectorStore().count()
  const [uptime, battery] = await Promise.all([getSystemUptime(), getBatteryLevel()])

  return [
    'Apex Status',
    `Vector Memory Facts: ${memoryCount}`,
    `System Uptime: ${uptime}`,
    `Battery: ${battery}`,
  ]
}
