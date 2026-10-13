import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  buildResetLink,
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from './resetToken';

test('generateResetToken returns a 32-byte hex token and is not predictable', () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const token = generateResetToken();
    assert.match(token, /^[0-9a-f]{64}$/); // 32 bytes -> 64 hex chars
    assert.equal(Buffer.from(token, 'hex').length, 32);
    tokens.add(token);
  }
  assert.equal(tokens.size, 200, 'tokens must be unique');
});

test('hashResetToken stores a SHA-256 hex digest, never the raw token', () => {
  const token = generateResetToken();
  const stored = hashResetToken(token);

  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.notEqual(stored, token);
  // Matches the digest an operator would compute by hand — this is the whole
  // point: the DB holds a one-way value.
  assert.equal(stored, crypto.createHash('sha256').update(token, 'utf8').digest('hex'));
});

test('hashing is deterministic, so resetPassword can look a token up by hash', () => {
  const token = generateResetToken();
  assert.equal(hashResetToken(token), hashResetToken(token));
  assert.notEqual(hashResetToken(token), hashResetToken(generateResetToken()));
});

test('buildResetLink points at the configured frontend and escapes the token', () => {
  assert.equal(
    buildResetLink('https://shop.example.com', 'abc123'),
    'https://shop.example.com/reset-password?token=abc123'
  );
  // No hardcoded domain, trailing slash tolerated.
  assert.equal(
    buildResetLink('https://shop.example.com/', 'abc123'),
    'https://shop.example.com/reset-password?token=abc123'
  );
  assert.equal(
    buildResetLink('https://shop.example.com', 'a b&c'),
    'https://shop.example.com/reset-password?token=a%20b%26c'
  );
});

test('token TTL is 30 minutes', () => {
  assert.equal(RESET_TOKEN_TTL_MS, 30 * 60 * 1000);
});