import { vectorStore } from '../db/vectorStore';

export async function getGatewayStatusLines(getSystemUptime: () => string, getBatteryLevel: () => string): Promise<string[]> {
  const memoryCount = await vectorStore.count();
  const uptime = getSystemUptime();
  const battery = getBatteryLevel();

  return [
    'OpenMac Status',
    `Vector Memory Facts: ${memoryCount}`,
    `System Uptime: ${uptime}`,
    `Battery: ${battery}`,
  ];
}
