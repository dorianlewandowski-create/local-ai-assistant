import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatRuntimeClientError,
  isMissingRuntimeAuthToken,
  isRuntimeHttpUnauthorized,
} from '../src/runtime/runtimeClientMessages'

test('formatRuntimeClientError: 401 includes token guidance', () => {
  const msg = formatRuntimeClientError('HTTP 401 - {"ok":false}')
  assert.match(msg, /401/)
  assert.match(msg, /OPERATOR_TRUST\.txt/)
  assert.match(msg, /apex runtime-info/)
  assert.match(msg, /Install drift/)
})

test('formatRuntimeClientError: missing token path', () => {
  const msg = formatRuntimeClientError('Missing Apex runtime auth token')
  assert.match(msg, /no token resolved/)
  assert.match(msg, /~\/.apex\/runtime\.token/)
})

test('isRuntimeHttpUnauthorized detects HTTP 401 prefix', () => {
  assert.equal(isRuntimeHttpUnauthorized('HTTP 401 - body'), true)
  assert.equal(isRuntimeHttpUnauthorized('nope'), false)
})

test('isMissingRuntimeAuthToken', () => {
  assert.equal(isMissingRuntimeAuthToken('Missing Apex runtime auth token'), true)
  assert.equal(isMissingRuntimeAuthToken('HTTP 401'), false)
})
