export async function runUpdateHelp(write: (line: string) => void = console.log): Promise<number> {
  write('Apex Update')
  write('Recommended flow (from a git checkout):')
  write('1. git pull')
  write('2. npm install   (pnpm users: pnpm install — same scripts, see package.json)')
  write('3. npm run build   (TypeScript project refs + dist/cli.bundle.js via build.mjs)')
  write('4. npm test   (optional but recommended before relying on the new build)')
  write('5. npm run doctor   and   apex runtime-info')
  write('6. If you use launchd: npm run launchd:install again, then:')
  write('     launchctl kickstart -k gui/$(id -u)/ai.apex.agent')
  write('')
  write(
    'If the CLI talks to an old daemon or you see HTTP 401: restart the daemon; align ~/.apex/runtime.token',
  )
  write('with the running process. See docs/OPERATOR_TRUST.txt.')
  return 0
}
