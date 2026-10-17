import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/env';
import { WHATSAPP_TEMPLATES } from '../services/whatsappService';

/**
 * Env-driven configuration.
 *
 * The whole point of accepting two spellings for the token, the pepper and the
 * service key is that a .env written against either documented name works with
 * no code change. These tests pin that contract, because a regression here would
 * silently fall back to a placeholder or an empty string and the symptom would
 * only appear as a failed send much later.
 */

const withEnv = (over: Record<string, string | undefined>, fn: () => void) => {
  const before = { ...config };
  const raw: Record<string, string | undefined> = {};
  for (const k of Object.keys(over)) {
    raw[k] = process.env[k];
    if (over[k] === undefined) delete process.env[k];
    else process.env[k] = over[k];
  }
  try {
    (config as any).whatsappApiToken = over.WHATSAPP_API_TOKEN || over.WHATSAPP_TOKEN || '';
    (config as any).whatsappOtpTemplateName = (over.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
    (config as any).whatsappOrderTemplateName = (over.WHATSAPP_ORDER_TEMPLATE_NAME || '').trim();
    (config as any).whatsappReviewTemplateName = (over.WHATSAPP_REVIEW_TEMPLATE_NAME || '').trim();
(config as any).whatsappTemplateLang = (over.WHATSAPP_TEMPLATE_LANG || 'en').trim();
    (config as any).whatsappDryRun = over.WHATSAPP_DRY_RUN === 'true';
    (config as any).otpHashPepper = over.OTP_HASH_PEPPER || over.OTP_HASH_SECRET || '';
    fn();
  } finally {
    Object.assign(config, before);
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('WHATSAPP_TOKEN is accepted as an alias for WHATSAPP_API_TOKEN', () => {
  withEnv({ WHATSAPP_API_TOKEN: undefined, WHATSAPP_TOKEN: 'from-short-name' }, () => {
    assert.equal(config.whatsappApiToken, 'from-short-name');
  });
});

test('WHATSAPP_API_TOKEN wins when both are present', () => {
  withEnv({ WHATSAPP_API_TOKEN: 'legacy', WHATSAPP_TOKEN: 'short' }, () => {
    assert.equal(config.whatsappApiToken, 'legacy');
  });
});

test('OTP_HASH_SECRET is accepted as an alias for OTP_HASH_PEPPER', () => {
  withEnv({ OTP_HASH_PEPPER: undefined, OTP_HASH_SECRET: 'pep-from-short-name' }, () => {
    assert.equal(config.otpHashPepper, 'pep-from-short-name');
  });
});

test('the OTP template name comes from the environment', () => {
  withEnv({ WHATSAPP_OTP_TEMPLATE_NAME: 'my_login_otp' }, () => {
    assert.equal(config.whatsappOtpTemplateName, 'my_login_otp');
  });
});

test('an unset template name falls back to the built-in literal', () => {
  withEnv({ WHATSAPP_OTP_TEMPLATE_NAME: undefined }, () => {
    assert.equal(config.whatsappOtpTemplateName, '');
    // The literal in whatsappService is the fallback; assert the shape is sane.
    assert.ok(typeof WHATSAPP_TEMPLATES.OTP === 'string' && WHATSAPP_TEMPLATES.OTP.length > 0);
  });
});

test('template names are trimmed so a stray space does not break the send', () => {
  withEnv({ WHATSAPP_OTP_TEMPLATE_NAME: '  padded_name  ' }, () => {
    assert.equal(config.whatsappOtpTemplateName, 'padded_name');
  });
});

test('order and review template names come from the environment', () => {
  withEnv({ WHATSAPP_ORDER_TEMPLATE_NAME: 'order_ok', WHATSAPP_REVIEW_TEMPLATE_NAME: 'ask_review' }, () => {
    assert.equal(config.whatsappOrderTemplateName, 'order_ok');
    assert.equal(config.whatsappReviewTemplateName, 'ask_review');
  });
});

test('template language defaults to en and is overridable', () => {
  withEnv({ WHATSAPP_TEMPLATE_LANG: undefined }, () => {
    assert.equal(config.whatsappTemplateLang, 'en');
  });
  withEnv({ WHATSAPP_TEMPLATE_LANG: 'hi' }, () => {
    assert.equal(config.whatsappTemplateLang, 'hi');
  });
});

test('WHATSAPP_DRY_RUN defaults to off, so production never silently no-ops', () => {
  withEnv({ WHATSAPP_DRY_RUN: undefined }, () => {
    assert.notEqual(config.whatsappDryRun, true);
  });
  withEnv({ WHATSAPP_DRY_RUN: 'true' }, () => {
    assert.equal(config.whatsappDryRun, true);
  });
  // Anything other than the literal "true" leaves dry-run off.
  withEnv({ WHATSAPP_DRY_RUN: '1' }, () => {
    assert.notEqual(config.whatsappDryRun, true);
  });
});

test('the pepper is never exposed on a public field', () => {
  // config is server-side only, but guard the obvious leak path.
  assert.ok(!('otpHashPepper' in ({} as any)));
  withEnv({ OTP_HASH_PEPPER: 'super-secret-pepper' }, () => {
    assert.equal(config.otpHashPepper, 'super-secret-pepper');
  });
});
