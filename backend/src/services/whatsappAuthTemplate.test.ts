/**
 * The AUTHENTICATION-category template payload.
 *
 * Meta rejects an authentication template unless the one-time code is supplied
 * TWICE: as the body parameter, and as the parameter of the COPY_CODE button at
 * index 0. Getting that wrong is the single most common reason an OTP send
 * fails at Meta, and it fails as a hard send error — the customer sees "we
 * could not send the code" for a template that is approved and looks correct.
 *
 * These tests pin the payload shape and prove the template name and language
 * come from the environment, never from a literal in the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/env';
import { buildAuthenticationTemplatePayload } from './whatsappService';

const PHONE = '9876543210';
const CODE = '483920';

test('the code is sent as the body parameter', () => {
  const payload = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  const body = payload.template.components.find((c: any) => c.type === 'body');
  assert.ok(body, 'a body component is required');
  assert.equal(body.parameters.length, 1);
  assert.deepEqual(body.parameters[0], { type: 'text', text: CODE });
});

test('the code is ALSO sent as the copy-code button parameter at index 0', () => {
  const payload = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  const button = payload.template.components.find((c: any) => c.type === 'button');
  assert.ok(button, 'a button component is required for the one-tap autofill');
  // Meta renders the copy-code button in two shapes, and the payload has to
  // match the approved template: a dedicated OTP button uses 'copy_code', a
  // URL button whose link carries the code uses 'url'. The resolver reads the
  // shape off the live template, so 'url' is the default.
  assert.equal(button.sub_type, 'url');
  // Meta takes the index as a STRING on the wire.
  assert.equal(button.index, '0');
  assert.deepEqual(button.parameters, [{ type: 'text', text: CODE }]);
});

test('the button sub_type follows the approved template when it is known', () => {
  // A template with a dedicated OTP button still needs 'copy_code'.
  const copyCode = buildAuthenticationTemplatePayload({
    to: PHONE,
    code: CODE,
    buttonSubType: 'copy_code',
  });
  assert.equal(copyCode.template.components[1].sub_type, 'copy_code');
  // ...and the code is still the button parameter in both shapes.
  assert.deepEqual(copyCode.template.components[1].parameters, [{ type: 'text', text: CODE }]);
});

test('the same code appears in both components — never two different values', () => {
  const payload = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  const body = payload.template.components.find((c: any) => c.type === 'body');
  const button = payload.template.components.find((c: any) => c.type === 'button');
  assert.equal(body.parameters[0].text, button.parameters[0].text);
});

test('the body component precedes the button component', () => {
  const payload = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  const types = payload.template.components.map((c: any) => c.type);
  assert.deepEqual(types, ['body', 'button']);
});

test('the recipient is normalised to the digits-only form Meta expects', () => {
  const payload = buildAuthenticationTemplatePayload({ to: '+91 98765 43210', code: CODE });
  assert.equal(payload.to, '919876543210');
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'template');
});

test('the template name comes from WHATSAPP_OTP_TEMPLATE_NAME, never a literal', () => {
  const before = (config as any).whatsappOtpTemplateName;
  try {
    (config as any).whatsappOtpTemplateName = 'login_auth';
    assert.equal(buildAuthenticationTemplatePayload({ to: PHONE, code: CODE }).template.name, 'login_auth');

    (config as any).whatsappOtpTemplateName = 'my_account_login_otp';
    assert.equal(
      buildAuthenticationTemplatePayload({ to: PHONE, code: CODE }).template.name,
      'my_account_login_otp'
    );
  } finally {
    (config as any).whatsappOtpTemplateName = before;
  }
});

test('the language comes from WHATSAPP_TEMPLATE_LANG, never a literal', () => {
  const before = (config as any).whatsappTemplateLang;
  try {
    (config as any).whatsappTemplateLang = 'en_US';
    assert.equal(
      buildAuthenticationTemplatePayload({ to: PHONE, code: CODE }).template.language.code,
      'en_US'
    );

    (config as any).whatsappTemplateLang = 'hi';
    assert.equal(
      buildAuthenticationTemplatePayload({ to: PHONE, code: CODE }).template.language.code,
      'hi'
    );
  } finally {
    (config as any).whatsappTemplateLang = before;
  }
});

test('an explicit templateName / language override wins, for tests and tools', () => {
  const payload = buildAuthenticationTemplatePayload({
    to: PHONE,
    code: CODE,
    templateName: 'other_auth',
    language: 'es',
  });
  assert.equal(payload.template.name, 'other_auth');
  assert.equal(payload.template.language.code, 'es');
});

test('the payload builder is pure and does not mutate anything', () => {
  const a = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  const b = buildAuthenticationTemplatePayload({ to: PHONE, code: CODE });
  assert.deepEqual(a, b);
  assert.notEqual(a.template, b.template, 'a fresh object each call');
});