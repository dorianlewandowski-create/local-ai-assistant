import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTotalCap,
  pickMarkdownExcerpt,
  stripYamlFrontmatter,
} from '../src/skills/data-analysis/excerpt'

test('stripYamlFrontmatter removes leading frontmatter', () => {
  const md = '---\ntitle: x\n---\n\n## Body\n\nHello'
  assert.equal(stripYamlFrontmatter(md).trimStart().startsWith('## Body'), true)
})

test('pickMarkdownExcerpt returns short docs unchanged', () => {
  assert.equal(pickMarkdownExcerpt('hello world', 'stats', 100), 'hello world')
})

test('pickMarkdownExcerpt prefers sections matching query tokens', () => {
  const md = [
    'Intro preamble.',
    '',
    '## Apples',
    'alpha',
    '',
    '## Bananas',
    'beta cohort retention funnel',
    '',
    '## Cherries',
    'gamma',
  ].join('\n')
  const out = pickMarkdownExcerpt(md, 'cohort retention analysis', 800)
  assert.match(out, /Bananas/i)
  assert.match(out, /cohort retention/i)
})

test('applyTotalCap truncates long payloads', () => {
  const s = 'x'.repeat(5000)
  const out = applyTotalCap(s, 200)
  assert.ok(out.length < s.length)
  assert.match(out, /global cap/i)
})
