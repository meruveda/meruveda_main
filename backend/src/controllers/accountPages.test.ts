/**
 * The account-pages switch (ACCOUNT_PAGES_ENABLED).
 *
 * While the flag is false the storefront's account pages (login, signup,
 * forgot/reset password and everything under /account) are switched off and
 * the only way a customer identifies themselves is the checkout contact step.
 *
 * These tests cover the two states:
 *   - false: a customer cannot sign in or sign up from the storefront, and
 *             the admin app is NOT affected (it is a separate app).
 *   - true:  everything works exactly as it did before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config/env';
import { login, register } from '../controllers/authController';
import * as usersRepo from '../database/repos/users';

function fakeRes(): any {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  return res;
}

const CUSTOMER = {
  id: 'customer-1',
  email: 'shopper@example.com',
  phone: '919876543210',
  password_hash: 'hash',
  first_name: 'Aarav',
  last_name: 'Sharma',
  role: 'customer',
  active: true,
};

const ADMIN = { ...CUSTOMER, id: 'admin-1', email: 'admin@example.com', role: 'admin' };

/** A password that bcrypt cannot match, so a wrong password never passes. */
const WRONG_PASSWORD = 'not-the-password';

test('a customer cannot sign in while the account pages are off', async () => {
  const before = config.accountPagesEnabled;
  const findByEmail = usersRepo.findByEmail;
  try {
    (config as any).accountPagesEnabled = false;
    (usersRepo as any).findByEmail = async () => CUSTOMER;

    const res = fakeRes();
    await login(
      { body: { email: CUSTOMER.email, password: WRONG_PASSWORD } } as any,
      res,
      () => undefined,
    );

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'ACCOUNT_PAGES_DISABLED');
    // The message tells the customer what to do instead.
    assert.match(String(res.body.error.message), /guest/i);
  } finally {
    (config as any).accountPagesEnabled = before;
    (usersRepo as any).findByEmail = findByEmail;
  }
});

test('a customer cannot sign up while the account pages are off', async () => {
  const before = config.accountPagesEnabled;
  try {
    (config as any).accountPagesEnabled = false;

    const res = fakeRes();
    await register(
      {
        body: { email: 'new@example.com', phone: '919876543210', password: 'secret123' },
        headers: {},
      } as any,
      res,
      () => undefined,
    );

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'ACCOUNT_PAGES_DISABLED');
  } finally {
    (config as any).accountPagesEnabled = before;
  }
});

test('the admin sign-in keeps working while the account pages are off', async () => {
  const before = config.accountPagesEnabled;
  const findByEmail = usersRepo.findByEmail;
  try {
    (config as any).accountPagesEnabled = false;
    (usersRepo as any).findByEmail = async () => ADMIN;

    const res = fakeRes();
    await login(
      { body: { email: ADMIN.email, password: WRONG_PASSWORD } } as any,
      res,
      () => undefined,
    );

    // The guard let the admin through: the answer is the normal "wrong
    // password" (401), NOT the "account pages are off" (404).
    assert.equal(res.statusCode, 401);
    assert.notEqual(res.body?.error?.code, 'ACCOUNT_PAGES_DISABLED');
  } finally {
    (config as any).accountPagesEnabled = before;
    (usersRepo as any).findByEmail = findByEmail;
  }
});

test('a customer sign-in works again once the account pages are on', async () => {
  const before = config.accountPagesEnabled;
  const findByEmail = usersRepo.findByEmail;
  try {
    (config as any).accountPagesEnabled = true;
    (usersRepo as any).findByEmail = async () => CUSTOMER;

    const res = fakeRes();
    await login(
      { body: { email: CUSTOMER.email, password: WRONG_PASSWORD } } as any,
      res,
      () => undefined,
    );

    // The guard did not fire: the answer is the normal "wrong password".
    assert.equal(res.statusCode, 401);
    assert.notEqual(res.body?.error?.code, 'ACCOUNT_PAGES_DISABLED');
  } finally {
    (config as any).accountPagesEnabled = before;
    (usersRepo as any).findByEmail = findByEmail;
  }
});
