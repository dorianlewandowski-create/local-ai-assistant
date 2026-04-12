/**
 * Golden eval suite (routing + tool policy + “don’t do X” negatives).
 * Cases live in golden.cases.json — bump `version` there when the schema changes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AgentFactory } from '../../src/agent/factory'
import { filterToolsForSubAgentKind } from '../../src/agent/subAgentToolPolicy'
import type { SubAgentKind } from '@apex/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface GoldenFile {
  version: number
  routing: Array<{
    id: string
    prompt: string
    metadata: Record<string, unknown>
    expectedKind: SubAgentKind
  }>
  routingOverrides: Array<{
    id: string
    prompt: string
    metadata: Record<string, unknown>
    expectedKind: SubAgentKind
  }>
  diagnosticsOverride: Array<{
    id: string
    prompt: string
    metadata: Record<string, unknown>
    expectedKind: SubAgentKind
    expectedSource: 'override' | 'heuristic'
    expectedConfidence: 'high' | 'medium' | 'low'
  }>
  toolPolicy: Array<{
    id: string
    subAgentKind: SubAgentKind
    allTools: string[]
    mustInclude: string[]
    mustExclude: string[]
  }>
  agentFactoryCreate: Array<{
    id: string
    kind: SubAgentKind
    allTools: string[]
    mustNotInclude: string[]
    mustIncludeAnyOf: string[]
  }>
  negatives: Array<{
    id: string
    prompt: string
    metadata: Record<string, unknown>
    mustNotRouteTo: SubAgentKind
    expectedKind?: SubAgentKind
  }>
}

function loadGolden(): GoldenFile {
  const path = join(__dirname, 'golden.cases.json')
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as GoldenFile
}

const golden = loadGolden()

test('golden.cases.json version is supported', () => {
  assert.equal(golden.version, 1)
})

test('routing: heuristic golden table', () => {
  const f = new AgentFactory('m', [])
  for (const row of golden.routing) {
    const got = f.choose(row.prompt, row.metadata)
    assert.equal(
      got,
      row.expectedKind,
      `[${row.id}] prompt=${JSON.stringify(row.prompt)} metadata=${JSON.stringify(row.metadata)}`,
    )
  }
})

test('routing: session override wins', () => {
  const f = new AgentFactory('m', [])
  for (const row of golden.routingOverrides) {
    assert.equal(
      f.choose(row.prompt, row.metadata),
      row.expectedKind,
      `[${row.id}]`,
    )
  }
})

test('routing: chooseWithDiagnostics for overrides', () => {
  const f = new AgentFactory('m', [])
  for (const row of golden.diagnosticsOverride) {
    const d = f.chooseWithDiagnostics(row.prompt, row.metadata)
    assert.equal(d.kind, row.expectedKind, `[${row.id}] kind`)
    assert.equal(d.source, row.expectedSource, `[${row.id}] source`)
    assert.equal(d.confidence, row.expectedConfidence, `[${row.id}] confidence`)
  }
})

test('tool policy: filterToolsForSubAgentKind', () => {
  for (const row of golden.toolPolicy) {
    const got = filterToolsForSubAgentKind(row.subAgentKind, row.allTools)
    for (const name of row.mustInclude) {
      assert.ok(got.includes(name), `[${row.id}] must include ${name}, got ${JSON.stringify(got)}`)
    }
    for (const name of row.mustExclude) {
      assert.ok(!got.includes(name), `[${row.id}] must exclude ${name}, got ${JSON.stringify(got)}`)
    }
  }
})

test('agent factory: researcher create() respects tier policy', () => {
  for (const row of golden.agentFactoryCreate) {
    const f = new AgentFactory('m', row.allTools)
    const cfg = f.create(row.kind)
    for (const name of row.mustNotInclude) {
      assert.ok(!cfg.tools.includes(name), `[${row.id}] must not include ${name}`)
    }
    const any = row.mustIncludeAnyOf.some((n) => cfg.tools.includes(n))
    assert.ok(any, `[${row.id}] expected at least one of ${JSON.stringify(row.mustIncludeAnyOf)}`)
  }
})

test('negatives: must not route to forbidden kind', () => {
  const f = new AgentFactory('m', [])
  for (const row of golden.negatives) {
    const got = f.choose(row.prompt, row.metadata)
    assert.notEqual(got, row.mustNotRouteTo, `[${row.id}] got ${got}, must not be ${row.mustNotRouteTo}`)
    if (row.expectedKind != null) {
      assert.equal(got, row.expectedKind, `[${row.id}] expectedKind`)
    }
  }
})
