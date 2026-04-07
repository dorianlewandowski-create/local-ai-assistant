import { execSync } from 'child_process';
import fs from 'fs/promises';

export async function captureScreenshot(filePath: string): Promise<void> {
  execSync(`screencapture -x ${filePath}`);
}

export async function cleanupScreenshot(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => undefined);
}
