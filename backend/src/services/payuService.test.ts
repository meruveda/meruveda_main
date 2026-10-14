import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { payuService } from './payuService';
import { config } from '../config/env';

/**
 * PayU hash generation and verification.
 *
 * The keys come from src/testEnvSetup.ts (test-merchant-key / test-salt). The
 * expected digests are rebuilt here from the published PayU field order rather
 * than hardcoded, so this pins the FIELD ORDER — which is what PayU signs — and
 * not just "some sha512".
 */

const KEY = config.payuMerchantKey;
const SALT = config.payuSalt;

/**
 * Response hash formula:
 *   salt|status|<5 placeholder fields>|udf5|udf4|udf3|udf2|udf1|
 *   email|firstname|productinfo|amount|txnid|key
 * The five placeholders are PayU response fields we do not read; with every
 * udf empty this is 11 pipes between `status` and `email`.
 */
function responseHashString(b: Record<string, string>, additionalCharges?: string) {
  const udf = [b.udf5, b.udf4, b.udf3, b.udf2, b.udf1].map((v) => v || '');
  const base = [
    SALT,
    b.status,
    '',
    '',
    '',
    '',
    '',
    ...udf,
    b.email,
    b.firstname,
    b.productinfo,
    b.amount,
    b.txnid,
    KEY,
  ].join('|');
  return additionalCharges ? `${additionalCharges}|${base}` : base;
}

test('generateRequestHash matches key|txnid|amount|...|salt sha512', () => {
  const params = {
    txnid: 'TXN-123',
    amount: 1180,
    productinfo: 'Ashwagandha',
    firstname: 'Asha',
    email: 'asha@example.com',
  };

  // key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||salt — the
  // five udfs are empty here, so that is 5 + 6 = 11 pipes before the salt.
  const expectedString =
    `${KEY}|TXN-123|1180.00|Ashwagandha|Asha|asha@example.com|||||||||||${SALT}`;
  const expected = crypto.createHash('sha512').update(expectedString).digest('hex');

  assert.equal(payuService.generateRequestHash(params), expected);
});

test('generateRequestHash formats the amount to 2 decimals whatever it is given', () => {
  const stringAmount = payuService.generateRequestHash({
    txnid: 'T',
    amount: '1180',
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
  });
  const numberAmount = payuService.generateRequestHash({
    txnid: 'T',
    amount: 1180,
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
  });
  const decimalAmount = payuService.generateRequestHash({
    txnid: 'T',
    amount: 1180.5,
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
  });

  assert.equal(stringAmount, numberAmount);
  assert.notEqual(decimalAmount, stringAmount, '1180.50 is a different signed value');
});

test('generateRequestHash carries udf fields in order', () => {
  const hash = payuService.generateRequestHash({
    txnid: 'T',
    amount: 100,
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
    udf1: 'u1',
    udf2: 'u2',
    udf3: 'u3',
    udf4: 'u4',
    udf5: 'u5',
  });

  const expected = crypto
    .createHash('sha512')
    .update(`${KEY}|T|100.00|P|F|E|u1|u2|u3|u4|u5||||||${SALT}`)
    .digest('hex');
  assert.equal(hash, expected);
});

test('verifyResponseHash accepts a correctly signed success response', () => {
  const body = {
    status: 'TXN_SUCCESS',
    txnid: 'TXN-123',
    amount: '1180.00',
    productinfo: 'Ashwagandha',
    firstname: 'Asha',
    email: 'asha@example.com',
    udf1: '',
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: '',
  };
  const hash = crypto
    .createHash('sha512')
    .update(responseHashString(body))
    .digest('hex');

  assert.equal(payuService.verifyResponseHash({ ...body, hash }), true);
});

test('verifyResponseHash rejects a tampered amount', () => {
  const body = {
    status: 'TXN_SUCCESS',
    txnid: 'TXN-123',
    amount: '1180.00',
    productinfo: 'Ashwagandha',
    firstname: 'Asha',
    email: 'asha@example.com',
    udf1: '',
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: '',
  };
  const hash = crypto
    .createHash('sha512')
    .update(responseHashString(body))
    .digest('hex');

  // Attacker lowers the amount: the hash no longer matches.
  assert.equal(payuService.verifyResponseHash({ ...body, amount: '1.00', hash }), false);
});

test('verifyResponseHash rejects a different txnid (replayed hash on another order)', () => {
  const body = {
    status: 'TXN_SUCCESS',
    txnid: 'TXN-123',
    amount: '1180.00',
    productinfo: 'Ashwagandha',
    firstname: 'Asha',
    email: 'asha@example.com',
    udf1: '',
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: '',
  };
  const hash = crypto
    .createHash('sha512')
    .update(responseHashString(body))
    .digest('hex');

  assert.equal(
    payuService.verifyResponseHash({ ...body, txnid: 'TXN-OTHER', hash }),
    false
  );
});

test('verifyResponseHash rejects missing, empty and garbage hashes', () => {
  const body = {
    status: 'TXN_SUCCESS',
    txnid: 'TXN-123',
    amount: '1180.00',
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
  };

  assert.equal(payuService.verifyResponseHash(body), false, 'no hash at all');
  assert.equal(payuService.verifyResponseHash({ ...body, hash: '' }), false);
  assert.equal(payuService.verifyResponseHash({ ...body, hash: 'deadbeef' }), false);
});

test('verifyResponseHash accounts for additionalCharges when PayU sends it', () => {
  const body = {
    status: 'TXN_SUCCESS',
    txnid: 'TXN-123',
    amount: '1180.00',
    productinfo: 'P',
    firstname: 'F',
    email: 'E',
  };
  const hash = crypto
    .createHash('sha512')
    .update(responseHashString(body, '50'))
    .digest('hex');

  assert.equal(
    payuService.verifyResponseHash({ ...body, additionalCharges: '50', hash }),
    true
  );
  // Same response without the additionalCharges field must NOT verify.
  assert.equal(payuService.verifyResponseHash({ ...body, hash }), false);
});