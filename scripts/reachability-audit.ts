import ts from 'typescript'
import path from 'node:path'
import fs from 'node:fs'

type AuditResult = {
  entrypoints: string[]
  reachableSrcFiles: string[]
  unreachableSrcFiles: string[]
  notes: string[]
}

function normalize(p: string): string {
  return p.split(path.sep).join('/')
}

function isUnder(dir: string, file: string): boolean {
  const d = path.resolve(dir) + path.sep
  const f = path.resolve(file)
  return f === path.resolve(dir) || f.startsWith(d)
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function loadTsConfig(repoRoot: string, tsconfigPath: string) {
  const cfgPath = path.resolve(repoRoot, tsconfigPath)
  const raw = ts.readConfigFile(cfgPath, ts.sys.readFile)
  if (raw.error) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext([raw.error], {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n',
    }))
  }
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(cfgPath))
  if (parsed.errors?.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n',
    }))
  }
  return parsed
}

function getEntrypoints(repoRoot: string): string[] {
  const candidates = [
    'src/index.ts',
    'src/cli.ts',
    'gateways/telegram/src/index.ts',
    'gateways/slack/src/index.ts',
    'gateways/whatsapp/src/index.ts',
    'gateways/screenshot/src/index.ts',
  ]
  return candidates
    .map((p) => path.resolve(repoRoot, p))
    .filter((p) => fs.existsSync(p))
}

function resolveImportedModule(
  moduleName: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
): string | null {
  const r = ts.resolveModuleName(moduleName, containingFile, compilerOptions, host)
  const f = r.resolvedModule?.resolvedFileName
  if (!f) return null
  // Ignore .d.ts (type-only) and library shims.
  if (f.endsWith('.d.ts')) return null
  return f
}

function main(): void {
  const repoRoot = process.cwd()
  const srcDir = path.resolve(repoRoot, 'src')

  const entrypoints = getEntrypoints(repoRoot)
  if (entrypoints.length === 0) {
    throw new Error('No entrypoints found.')
  }

  const parsed = loadTsConfig(repoRoot, 'tsconfig.app.json')
  const options = parsed.options
  const host = ts.createCompilerHost(options, true)

  const visited = new Set<string>()
  const queue: string[] = [...entrypoints]

  const notes: string[] = []
  notes.push(
    'This audit is static: it follows TypeScript/JavaScript import/export and require() with string literals only.',
  )
  notes.push('Dynamic requires, computed imports, runtime plugin loading, and JSON manifest discovery are not modeled.')

  while (queue.length > 0) {
    const file = queue.pop()!
    const abs = path.resolve(file)
    if (visited.has(abs)) continue
    visited.add(abs)

    const sourceText = host.readFile(abs)
    if (sourceText == null) continue

    const sf = ts.createSourceFile(abs, sourceText, ts.ScriptTarget.ES2022, true)

    const addNext = (resolved: string | null) => {
      if (!resolved) return
      const rAbs = path.resolve(resolved)
      if (!visited.has(rAbs)) queue.push(rAbs)
    }

    const visit = (node: ts.Node) => {
      // import ... from 'x'
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        addNext(resolveImportedModule(node.moduleSpecifier.text, abs, options, host))
      }

      // export ... from 'x'
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        addNext(resolveImportedModule(node.moduleSpecifier.text, abs, options, host))
      }

      // require('x') with literal
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        addNext(resolveImportedModule(node.arguments[0].text, abs, options, host))
      }

      ts.forEachChild(node, visit)
    }

    visit(sf)
  }

  const allSrcFiles = parsed.fileNames
    .map((f) => path.resolve(f))
    .filter((f) => isUnder(srcDir, f))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => !f.endsWith('.d.ts'))

  const reachableSrcFiles = allSrcFiles.filter((f) => visited.has(f))
  const unreachableSrcFiles = allSrcFiles.filter((f) => !visited.has(f))

  const result: AuditResult = {
    entrypoints: entrypoints.map(normalize),
    reachableSrcFiles: reachableSrcFiles.map(normalize).sort(),
    unreachableSrcFiles: unreachableSrcFiles.map(normalize).sort(),
    notes,
  }

  const outPath = path.resolve(repoRoot, 'reachability-report.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.relative(repoRoot, outPath)} (${result.unreachableSrcFiles.length} unreachable src files).`)
}

main()

