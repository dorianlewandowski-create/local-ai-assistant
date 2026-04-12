Golden eval suite (test/evals/)
================================

Purpose
  Small, OpenAI/Anthropic-style *golden* checks so routing and tool-tier refactors
  stay safe without booting full LLM flows.

Files
  golden.cases.json  — versioned case data (routing, tool policy, negatives).
  goldenEval.test.ts — loads JSON and asserts (run via npm test or npm run test:eval).

How to extend
  1. Edit golden.cases.json (bump "version" if you change the JSON shape).
  2. Run: npm run test:eval   or   npm test
  3. When changing heuristic keywords, update routing[] expectations if behavior shifts.

Related code
  src/agent/factory.ts
  src/agent/subAgentToolPolicy.ts
