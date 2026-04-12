import test from 'node:test'
import assert from 'node:assert/strict'
import { generatePairingCode, pairingCodesEqual } from '@apex/core'

test('generatePairingCode returns 8 uppercase hex chars', () => {
  const code = generatePairingCode()
  assert.match(code, /^[0-9A-F]{8}$/)
})

test('pairingCodesEqual is case-insensitive for hex', () => {
  assert.equal(pairingCodesEqual('ABCD1234', 'abcd1234'), true)
  assert.equal(pairingCodesEqual('ABCD1234', 'ABCD1235'), false)
})
