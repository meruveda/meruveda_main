/**
 * The end-to-end check of the checkout-created profile.
 *
 * Run against localhost first, then against production:
 *
 *   node scripts/verify-checkout-profile.js http://localhost:3000
 *   node scripts/verify-checkout-profile.js https://meruvedawellness.com
 *
 * It walks through a real browser:
 *   a. add to cart -> checkout -> name, number, email -> Continue -> address
 *      -> COD order -> /account shows the profile and the order
 *   b. a SECOND browser with the SAME number must not see the first browser's
 *      profile or orders
 *   c. a visitor with no session: /account redirects once to /, the header has
 *      no account icon and there is no login/signup link
 *   d. no horizontal scroll on any /account page, on mobile and on desktop
 *   e. the admin sign-in page still works
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const SHOTS = process.env.SHOT_DIR || path.join(require('os').tmpdir(), 'meruveda-shots');
const PHONE = process.env.TEST_PHONE || '7222902273';
const EMAIL = process.env.TEST_EMAIL || 'checkout.profile@example.com';
const NAME = process.env.TEST_NAME || 'Checkout Profile Tester';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function shot(page, name) {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  } catch {
    /* a screenshot is a nice-to-have */
  }
}

/** Has the page scrolled sideways? (the mobile overflow check) */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(0, d.scrollWidth - d.clientWidth);
  });
}

/** Add the first product to the cart and open the checkout. */
async function openCheckout(page) {
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  const add = page.getByRole('button', { name: 'Add to Cart' }).first();
  await add.waitFor({ timeout: 90000 });
  await add.click();
  await page.waitForTimeout(2500);

  // The checkout sends a visitor with an empty cart back to the shop, and a
  // dev server can take a while to compile the page: retry a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
    try {
      await page.getByPlaceholder('Enter your full name').first().waitFor({ timeout: 45000 });
      await page.waitForTimeout(800);
      return;
    } catch {
      if (!page.url().includes('/checkout')) {
        await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
        const again = page.getByRole('button', { name: 'Add to Cart' }).first();
        await again.waitFor({ timeout: 60000 });
        await again.click();
        await page.waitForTimeout(2000);
      }
    }
  }
  throw new Error(`the checkout did not open (last url: ${page.url()})`);
}

/** Fill the contact step and press Continue. */
async function continueWithContact(page, name, phone, email) {
  await page.getByPlaceholder('Enter your full name').first().fill(name);
  await page.locator('#checkout-mobile').first().fill(phone);
  await page.locator('#checkout-contact-email').first().fill(email);
  await page.waitForTimeout(300);
  /**
   * The endpoint refuses a form that was submitted implausibly fast (less
   * than three seconds after the page rendered) - a human cannot fill a name,
   * a number and an email that fast. The test waits, like a person would.
   */
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await page.waitForTimeout(4000);
}


/** Fill the address step. */
async function fillAddress(page) {
  await page.locator('#address-house').fill('12, Sunrise Residency');
  await page.locator('#address-area').fill('MG Road');
  await page.locator('#address-city').fill('Bengaluru');
  await page.locator('#address-pincode').fill('560001');

  // The state is a searchable combobox.
  const state = page.locator('#checkout-state');
  await state.click();
  await page.waitForTimeout(500);
  const option = page.getByRole('option', { name: /Karnataka/i }).first();
  if (await option.count()) {
    await option.click();
  } else {
    await state.fill('Karnataka');
    await page.waitForTimeout(500);
    await page.getByRole('option').first().click();
  }
  await page.waitForTimeout(500);

  // The delivery step has its own email field.
  const email = page.locator('#checkout-email-input');
  if (await email.count()) {
    await email.fill(EMAIL);
    await page.waitForTimeout(300);
  }

  // Save the address so it is the one the order is placed to.
  const save = page.getByRole('button', { name: /save address/i }).first();
  if (await save.count()) {
    await save.click();
    await page.waitForTimeout(2500);
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });

  /* ---------------------------------------------------------------- */
  /* a. The happy path                                                */
  /* ---------------------------------------------------------------- */
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push(String(e.message)));

  await openCheckout(pageA);
  await continueWithContact(pageA, NAME, PHONE, EMAIL);
  await shot(pageA, 'a1-checkout-after-continue');

  const contactConfirmed = await pageA.locator('[data-contact-confirmed="yes"]').count();
  check('a. Continue confirms the contact', contactConfirmed > 0);

  const cookies = await ctxA.cookies();
  const sessionCookie = cookies.find((c) => c.name === 'mv_customer_session');
  check('a. the session cookie is set', Boolean(sessionCookie));
  if (sessionCookie) {
    check('a. the cookie is httpOnly', sessionCookie.httpOnly === true);
    check('a. the cookie is SameSite=Lax', String(sessionCookie.sameSite).toLowerCase() === 'lax', sessionCookie.sameSite);
    const days = sessionCookie.expires ? Math.round((sessionCookie.expires * 1000 - Date.now()) / 86400000) : 0;
    check('a. the cookie lives for ~90 days', days > 80 && days <= 91, `${days} days`);
  }

  const accountIcon = await pageA.locator('header a[href="/account"], header [aria-label="My Profile"]').count();
  check('a. the header shows the account icon', accountIcon > 0);

  // The address, then a COD order.
  await fillAddress(pageA);
  await pageA.waitForTimeout(800);
  await shot(pageA, 'a2-checkout-address');

  // Cash on delivery.
  const codCard = pageA.getByText('Cash on Delivery', { exact: false }).first();
  if (await codCard.count()) {
    await codCard.click();
    await pageA.waitForTimeout(800);
  }

  // The order button is labelled "Place Order" or "Pay Now".
  const placeOrder = pageA.getByRole('button', { name: /place order|pay now/i }).first();
  check('a. the order button is ready', (await placeOrder.count()) > 0);
  if (await placeOrder.count()) {
    await placeOrder.click();
    await pageA.waitForTimeout(12000);
  }
  const orderUrl = pageA.url();
  check('a. the COD order is placed', /\/checkout\/success\//.test(orderUrl), orderUrl);
  await shot(pageA, 'a3-order-success');

  /* ---------------------------------------------------------------- */
  /* c. A visitor with no session                                      */
  /* ---------------------------------------------------------------- */
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageC = await ctxC.newPage();
  await pageC.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageC.waitForTimeout(4000);
  const landed = pageC.url();
  check('c. /account sends a visitor without a session to the shop', landed.includes('profile=required') || landed.replace(/\/+$/, '').endsWith(BASE.replace(/\/+$/, '')), landed);
  await shot(pageC, 'c1-no-session-redirect');

  const headerAccount = await pageC.locator('header a[href="/account"], header [aria-label="My Profile"]').count();
  check('c. the header has no account icon without a session', headerAccount === 0);
  const loginLinks = await pageC.locator('a[href="/login"], a[href="/signup"]').count();
  check('c. there is no login or signup link anywhere', loginLinks === 0, `${loginLinks} found`);
  const trackLink = await pageC.locator('header a[href="/track"]').count();
  check('c. /track is linked for everybody', trackLink > 0);
  const notice = (await pageC.textContent('body')) || '';
  check('c. the shop explains why', /place an order to create your profile/i.test(notice));

  /* ---------------------------------------------------------------- */
  /* b. A second browser with the SAME number                          */
  /* ---------------------------------------------------------------- */
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageB = await ctxB.newPage();
  await openCheckout(pageB);
  await continueWithContact(pageB, 'Someone Else', PHONE, 'someone.else@example.com');
  await shot(pageB, 'b1-second-browser-continue');

  await pageB.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(4000);
  const bodyB = (await pageB.textContent('body')) || '';
  check('b. the second browser shows its own name', bodyB.includes('Someone Else'));
  check('b. the second browser does NOT show the first profile', !bodyB.includes(NAME));
  check('b. the second browser does NOT show the first email', !bodyB.toLowerCase().includes(EMAIL.toLowerCase()));
  await shot(pageB, 'b2-second-browser-account');

  /* ---------------------------------------------------------------- */
  /* a (continued). The first browser's own account                    */
  /* ---------------------------------------------------------------- */
  await pageA.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(4000);
  const bodyA = (await pageA.textContent('body')) || '';
  check('a. /account shows the profile name', bodyA.includes(NAME));
  check('a. /account shows the email', bodyA.toLowerCase().includes(EMAIL.toLowerCase()));
  check('a. /account shows the number', bodyA.includes(PHONE) || bodyA.includes('+91 72229 02273') || bodyA.includes('7222902273'));
  await shot(pageA, 'a4-account-profile');

  await pageA.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(4000);
  const ordersBody = (await pageA.textContent('body')) || '';
  check('a. the order history shows the order', /MV-\\d+/i.test(ordersBody), 'orders listed');
  await shot(pageA, 'a5-account-orders');

  /* ---------------------------------------------------------------- */
  /* d. No horizontal scroll                                           */
  /* ---------------------------------------------------------------- */
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const ctxD = await browser.newContext({ viewport });
    const pageD = await ctxD.newPage();
    for (const url of ['/account', '/account/orders', '/account/addresses', '/account/profile']) {
      await pageD.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
      await pageD.waitForTimeout(3000);
      const overflow = await horizontalOverflow(pageD);
      check(`d. no horizontal scroll on ${url} (${label})`, overflow <= 2, `${overflow}px`);
      await shot(pageD, `d-${label}${url.replace(/\//g, '-')}`);
    }
    await ctxD.close();
  }

  /* ---------------------------------------------------------------- */
  /* e. The admin sign-in still works                                  */
  /* ---------------------------------------------------------------- */
  const adminRes = await pageC.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await pageC.waitForTimeout(4000);
  const adminBody = (await pageC.textContent('body')) || '';
  check('e. the admin sign-in page loads', adminRes.status() === 200 && adminBody.includes('Admin Portal'), `status ${adminRes.status()}`);
  await shot(pageC, 'e1-admin-login');

  check('a. no uncaught page errors during the run', errorsA.length === 0, errorsA.slice(0, 2).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `result-${BASE.replace(/[^a-z0-9]/gi, '-')}.json`), JSON.stringify(results, null, 2));
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('verification failed:', err?.message || err);
  process.exit(1);
});
