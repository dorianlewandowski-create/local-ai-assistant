import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

export type SandboxLanguage = 'javascript' | 'python'

export type SandboxRunResult = {
  output: string
  error: string
  runtimeMs: number
}

function resolveRuntime(language: SandboxLanguage): {
  runtime: string
  runtimeArgs: string[]
  evalFlag: string
} {
  switch (language) {
    case 'javascript':
      // Limit JS heap to reduce risk of runaway memory usage.
      return { runtime: 'node', runtimeArgs: ['--max-old-space-size=128'], evalFlag: '-e' }
    case 'python':
      // Python has no simple CLI memory flag; we apply a best-effort limit via `resource` in the wrapper.
      return { runtime: 'python3', runtimeArgs: [], evalFlag: '-c' }
  }
}

export class MacSandbox {
  async runCode(language: SandboxLanguage, code: string): Promise<SandboxRunResult> {
    const startedAt = Date.now()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-sbx-'))

    try {
      const { runtime, runtimeArgs, evalFlag } = resolveRuntime(language)

      // Must match the requested command structure:
      // sandbox-exec -f ./src/sandbox/apex_code.sb node -e "[CODE]"
      const profilePath = path.join('.', 'src', 'sandbox', 'apex_code.sb')
      const env = { ...process.env }

      let finalCode = code
      if (language === 'python') {
        // Best-effort memory limit for Python using RLIMIT_AS (address space).
        // We pass the user code via an env var to avoid quoting issues.
        const codeB64 = Buffer.from(code, 'utf-8').toString('base64')
        env.APEX_CODE_B64 = codeB64
        env.APEX_PY_AS_LIMIT_MB = '256'
        finalCode = [
          'import os,base64',
          'try:',
          '  import resource',
          '  mb=int(os.environ.get("APEX_PY_AS_LIMIT_MB","256"))',
          '  limit=mb*1024*1024',
          '  resource.setrlimit(resource.RLIMIT_AS,(limit,limit))',
          'except Exception:',
          '  pass',
          'src=base64.b64decode(os.environ.get("APEX_CODE_B64","")).decode("utf-8","replace")',
          'exec(compile(src,"<sandbox>","exec"),{})',
        ].join('\\n')
      }

      const args = ['-f', profilePath, runtime, ...runtimeArgs, evalFlag, finalCode]

      const result = spawnSync('sandbox-exec', args, {
        cwd: process.cwd(),
        env,
        encoding: 'utf-8',
        timeout: 5_000,
        maxBuffer: 5 * 1024 * 1024,
      })

      const runtimeMs = Date.now() - startedAt
      const timeoutMsg =
        result.error && (result.error as any).code === 'ETIMEDOUT'
          ? `Sandbox execution timed out after 5000ms.\n`
          : ''

      return {
        output: String(result.stdout ?? '').trim(),
        error: (
          timeoutMsg +
          String(result.stderr ?? '') +
          (result.error ? `\n${result.error.message}` : '')
        ).trim(),
        runtimeMs,
      }
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
}

export async function testSandbox(): Promise<SandboxRunResult> {
  const chaosScript = `
process.on('uncaughtException', (e) => {
  console.log('3. NETWORK TEST: BLOCKED (Correct)');
});
process.on('unhandledRejection', (e) => {
  console.log('3. NETWORK TEST: BLOCKED (Correct)');
});

const fs = require('fs');
console.log('1. MATH TEST:', Math.sqrt(144) * Math.PI);
try {
  console.log('2. FILE TEST:', fs.readFileSync('/etc/hosts', 'utf8').substring(0, 10));
} catch (e) {
  console.log('2. FILE TEST: BLOCKED (Correct)');
}
try {
  require('http').get('http://google.com');
  console.log('3. NETWORK TEST: SUCCESS (Fail!)');
} catch (e) {
  console.log('3. NETWORK TEST: BLOCKED (Correct)');
}
`.trim()

  const sandbox = new MacSandbox()
  return sandbox.runCode('javascript', chaosScript)
}
