import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Read a generic password from macOS Keychain.
 *
 * Returns undefined when item not found or access denied.
 */
export async function readKeychainGenericPassword(options: {
  service: string
  account: string
}): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      options.service,
      '-a',
      options.account,
      '-w',
    ])
    const value = String(stdout ?? '').trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}
