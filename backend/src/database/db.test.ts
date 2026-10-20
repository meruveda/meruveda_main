import assert from 'node:assert/strict';
import test from 'node:test';
import {
  typeParsers,
  isUniqueViolation,
  isUndefinedColumn,
  isUndefinedTable,
  isReadOnlySql,
  isTransientError,
} from './db';

test('NUMERIC is parsed to a JS number (PostgREST parity)', () => {
  const parse = typeParsers.getTypeParser(1700);
  assert.equal(parse('1299.50'), 1299.5);
  assert.equal(parse('0'), 0);
  assert.equal(parse('-42.25'), -42.25);
  assert.equal(parse(null), null);
});

test('BIGINT is parsed to a JS number (PostgREST parity)', () => {
  const parse = typeParsers.getTypeParser(20);
  assert.equal(parse('42'), 42);
  assert.equal(parse('0'), 0);
  assert.equal(parse(null), null);
});

test('text and uuid columns stay strings', () => {
  const textParse = typeParsers.getTypeParser(25);
  assert.equal(textParse('123'), '123');
  const uuidParse = typeParsers.getTypeParser(2950);
  assert.equal(uuidParse('123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000');
});

test('jsonb is parsed to an object', () => {
  const parse = typeParsers.getTypeParser(3802);
  assert.deepEqual(parse('{"a":1}'), { a: 1 });
});

test('timestamps are returned as ISO strings (PostgREST parity)', () => {
  const parse = typeParsers.getTypeParser(1184);
  assert.equal(typeof parse('2026-10-17 10:52:14+00'), 'string');
});

test('postgres error helpers recognise the codes the auth/otp flows rely on', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '42P01' }), false);
  assert.equal(isUndefinedTable({ code: '42P01' }), true);
  assert.equal(isUndefinedColumn({ code: '42703' }), true);
});

test('isReadOnlySql: only idempotent reads are classified as reads', () => {
  assert.equal(isReadOnlySql('SELECT * FROM orders'), true);
  assert.equal(isReadOnlySql('  select 1'), true);
  assert.equal(isReadOnlySql('SHOW search_path'), true);
  assert.equal(isReadOnlySql('EXPLAIN SELECT * FROM orders'), true);
  assert.equal(isReadOnlySql('-- a comment\nSELECT 1'), true);
  assert.equal(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  // read-only CTE wrapping a write must NOT be retried
  assert.equal(isReadOnlySql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'), false);
  assert.equal(isReadOnlySql('WITH x AS (SELECT 1) UPDATE t SET a = 1'), false);
  assert.equal(isReadOnlySql('INSERT INTO orders (id) VALUES (1)'), false);
  assert.equal(isReadOnlySql('UPDATE orders SET status = $1'), false);
  assert.equal(isReadOnlySql('DELETE FROM orders WHERE id = $1'), false);
  assert.equal(isReadOnlySql(''), false);
});

test('isTransientError: transient connection faults retry, real DB errors do not', () => {
  assert.equal(isTransientError({ code: '57P01' }), true);
  assert.equal(isTransientError({ code: '53300' }), true);
  assert.equal(isTransientError({ code: '08006' }), true);
  assert.equal(isTransientError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isTransientError({ message: 'fetch failed' }), true);
  assert.equal(isTransientError({ name: 'AbortError' }), true);
  // business errors must never be retried
  assert.equal(isTransientError({ code: '23505' }), false);
  assert.equal(isTransientError({ code: '42P01' }), false);
  assert.equal(isTransientError({ code: '23503' }), false);
  assert.equal(isTransientError(null), false);
});
