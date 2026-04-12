// Worker-thread compatibility shim.
//
// Plugin workers load plugins via dynamic `import()` from plain Node.js (no TS loader).
// This wrapper enables loading the TypeScript implementation during development/tests.
require('ts-node/register')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('./index.ts')
module.exports = mod?.default ?? mod?.plugin ?? mod
