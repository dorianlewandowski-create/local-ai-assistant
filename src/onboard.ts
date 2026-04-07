import fs from 'fs';
import path from 'path';

function ensureFile(targetPath: string, sourcePath: string, write: (line: string) => void) {
  if (fs.existsSync(targetPath)) {
    write(`Exists: ${path.basename(targetPath)}`);
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
  write(`Created: ${path.basename(targetPath)}`);
}

export async function runOnboard(write: (line: string) => void = console.log): Promise<number> {
  const root = process.cwd();
  write('OpenMac Onboard');

  ensureFile(path.join(root, '.env'), path.join(root, '.env.example'), write);
  ensureFile(path.join(root, 'openmac.json'), path.join(root, 'openmac.json.example'), write);

  write('Next steps:');
  write('1. Fill in .env secrets and tokens');
  write('2. Adjust openmac.json settings if needed');
  write('3. Run: npm run doctor');
  write('4. Optionally run: npm link');
  return 0;
}
