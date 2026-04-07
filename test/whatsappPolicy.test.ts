import test from 'node:test';
import assert from 'node:assert/strict';
import { isWhatsAppMessageAuthorized } from '../src/gateways/whatsappPolicy';
import { OpenMacConfig } from '../src/config';

function makeConfig(overrides: Partial<OpenMacConfig['gateways']['whatsapp']> = {}): OpenMacConfig['gateways']['whatsapp'] {
  return {
    enabled: true,
    executablePath: undefined,
    allowFrom: [],
    groupPolicy: 'disabled',
    groupAllowFrom: [],
    ...overrides,
  };
}

test('whatsapp direct chat uses allowFrom', () => {
  const config = makeConfig({ allowFrom: ['123@c.us'] });
  assert.equal(isWhatsAppMessageAuthorized('123@c.us', '123@c.us', config), true);
  assert.equal(isWhatsAppMessageAuthorized('999@c.us', '999@c.us', config), false);
});

test('whatsapp group policy disabled blocks groups', () => {
  const config = makeConfig({ groupPolicy: 'disabled' });
  assert.equal(isWhatsAppMessageAuthorized('group@g.us', '123@c.us', config), false);
});

test('whatsapp group policy open allows groups', () => {
  const config = makeConfig({ groupPolicy: 'open' });
  assert.equal(isWhatsAppMessageAuthorized('group@g.us', '123@c.us', config), true);
});

test('whatsapp group allowlist falls back to allowFrom', () => {
  const config = makeConfig({ groupPolicy: 'allowlist', allowFrom: ['123@c.us'] });
  assert.equal(isWhatsAppMessageAuthorized('group@g.us', '123@c.us', config), true);
  assert.equal(isWhatsAppMessageAuthorized('group@g.us', '999@c.us', config), false);
});
