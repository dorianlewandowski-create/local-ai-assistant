/**
 * Build status lines for gateway /status commands.
 *
 * The uptime/battery providers are async to avoid blocking the event loop.
 */
export async function getGatewayStatusLines(
  getSystemUptime: () => Promise<string>,
  getBatteryLevel: () => Promise<string>,
  getVectorMemoryFactsCount?: () => Promise<number>,
): Promise<string[]> {
  const memoryCount = getVectorMemoryFactsCount ? await getVectorMemoryFactsCount() : null
  const [uptime, battery] = await Promise.all([getSystemUptime(), getBatteryLevel()])

  return [
    'Apex Status',
    `Vector Memory Facts: ${memoryCount ?? 'Unavailable'}`,
    `System Uptime: ${uptime}`,
    `Battery: ${battery}`,
  ]
}
