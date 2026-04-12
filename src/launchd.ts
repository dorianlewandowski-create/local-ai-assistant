import fs from 'fs'
import os from 'os'
import path from 'path'

export function getLaunchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.apex.agent.plist')
}

export function buildLaunchdPlist(projectRoot: string): string {
  const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Apex')
  const outLog = path.join(logDir, 'daemon.out.log')
  const errLog = path.join(logDir, 'daemon.err.log')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.apex.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${projectRoot}/bin/run.sh</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APEX_INSTALL_ROOT</key>
    <string>${projectRoot}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
</dict>
</plist>`
}

export async function installLaunchdPlist(write: (line: string) => void = console.log): Promise<number> {
  const projectRoot = process.cwd()
  const targetPath = getLaunchdPlistPath()
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.mkdirSync(path.join(os.homedir(), 'Library', 'Logs', 'Apex'), { recursive: true })
  fs.writeFileSync(targetPath, buildLaunchdPlist(projectRoot))
  write(`Wrote launchd plist to ${targetPath}`)
  write(`Load it with: launchctl bootstrap gui/$(id -u) ${targetPath}`)
  write(`Unload it with: launchctl bootout gui/$(id -u) ${targetPath}`)
  write(
    `After git pull or moving the repo, run this again so ProgramArguments and APEX_INSTALL_ROOT match the current tree.`,
  )
  return 0
}
