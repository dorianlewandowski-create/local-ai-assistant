import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function writeTempMediaFile(prefix: string, extension: string, buffer: Buffer): Promise<string> {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`,
  )
  await fs.writeFile(filePath, buffer)
  return filePath
}

export async function cleanupTempFile(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return
  }

  await fs.unlink(filePath).catch(() => undefined)
}
