import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const RELEASES_DIR = 'releases';
const REQUIRED_RELEASE_FILES = [
  'dist/cli.js',
  'dist/index.js',
  'bin/openmac',
  'README.md',
  '.env.example',
  'openmac.json.example',
  'package.json',
  'package-lock.json',
  'node_modules',
];

function copyRecursive(source: string, target: string): void {
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function writeReleaseLauncher(targetPath: string): void {
  const content = '#!/bin/bash\nDIR="$( cd "$( dirname "$0" )/.." >/dev/null 2>&1 && pwd )"\ncd "$DIR"\nexec node dist/cli.js "$@"\n';
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  fs.chmodSync(targetPath, 0o755);
}

function buildReleasePackageJson(root: string): Record<string, unknown> {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, any>;
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: 'dist/index.js',
    bin: {
      openmac: './bin/openmac',
    },
    dependencies: pkg.dependencies,
  };
}

export async function runReleasePack(write: (line: string) => void = console.log): Promise<number> {
  const root = process.cwd();
  const distPath = path.join(root, 'dist');
  if (!fs.existsSync(distPath)) {
    throw new Error('Build output missing. Run `npm run build` before packaging a release.');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const version = pkg.version;
  const releaseName = `openmac-${version}`;
  const releasesDir = path.join(root, RELEASES_DIR);
  const stagingDir = path.join(releasesDir, releaseName);
  const archivePath = path.join(releasesDir, `${releaseName}.tar.gz`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  copyRecursive(distPath, path.join(stagingDir, 'dist'));
  copyRecursive(path.join(root, '.env.example'), path.join(stagingDir, '.env.example'));
  copyRecursive(path.join(root, 'openmac.json.example'), path.join(stagingDir, 'openmac.json.example'));
  copyRecursive(path.join(root, 'README.md'), path.join(stagingDir, 'README.md'));
  copyRecursive(path.join(root, 'package-lock.json'), path.join(stagingDir, 'package-lock.json'));
  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify(buildReleasePackageJson(root), null, 2),
    'utf8',
  );
  writeReleaseLauncher(path.join(stagingDir, 'bin', 'openmac'));

  write('Installing production dependencies into release staging...');
  execFileSync('npm', ['ci', '--omit=dev'], {
    cwd: stagingDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: 'true',
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
    },
  });

  execFileSync('tar', ['-czf', archivePath, '-C', releasesDir, releaseName]);

  write(`Release staging directory: ${stagingDir}`);
  write(`Release archive: ${archivePath}`);
  write('Install flow: tar -xzf <archive> && cd openmac-<version> && ./bin/openmac update');
  return 0;
}

export async function runReleaseVerify(write: (line: string) => void = console.log): Promise<number> {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const releaseName = `openmac-${pkg.version}`;
  const stagingDir = path.join(root, RELEASES_DIR, releaseName);
  const archivePath = path.join(root, RELEASES_DIR, `${releaseName}.tar.gz`);

  if (!fs.existsSync(stagingDir)) {
    throw new Error(`Release staging directory missing: ${stagingDir}. Run npm run release:pack first.`);
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Release archive missing: ${archivePath}. Run npm run release:pack first.`);
  }

  for (const relativePath of REQUIRED_RELEASE_FILES) {
    const fullPath = path.join(stagingDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Release verification failed. Missing ${relativePath} in ${stagingDir}`);
    }
  }

  const archiveStats = fs.statSync(archivePath);
  if (archiveStats.size === 0) {
    throw new Error(`Release archive is empty: ${archivePath}`);
  }

  execFileSync('node', ['dist/cli.js', 'update'], {
    cwd: stagingDir,
    stdio: 'ignore',
  });

  write(`Release verification passed for ${releaseName}`);
  write(`Verified archive: ${archivePath}`);
  return 0;
}
