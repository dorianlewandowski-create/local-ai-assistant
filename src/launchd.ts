import fs from 'fs';
import os from 'os';
import path from 'path';

export function getLaunchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.openmac.agent.plist');
}

export function buildLaunchdPlist(projectRoot: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openmac.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${projectRoot}/bin/run.sh</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${projectRoot}/data/openmac.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${projectRoot}/data/openmac.launchd.err.log</string>
</dict>
</plist>`;
}

export async function installLaunchdPlist(write: (line: string) => void = console.log): Promise<number> {
  const projectRoot = process.cwd();
  const targetPath = getLaunchdPlistPath();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
  fs.writeFileSync(targetPath, buildLaunchdPlist(projectRoot));
  write(`Wrote launchd plist to ${targetPath}`);
  write(`Load it with: launchctl load ${targetPath}`);
  write(`Unload it with: launchctl unload ${targetPath}`);
  return 0;
}
