import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export async function writeTempMediaFile(prefix: string, extension: string, buffer: Buffer): Promise<string> {
  const filePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function cleanupTempFile(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
}
