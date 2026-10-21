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
 *      -> COD order -> /account shows the profile and the order with its
 *      status
 *   b. a SECOND browser with the SAME number must not see the first browser's
 *      profile, email or orders
 *   c. a visitor with no session: the profile icon is in the header, /account
 *      shows the empty state ONCE (no redirect, no loop), there is no
 *      login/signup link and those routes answer 307 to /
 *   d. the navbar has no "Track order", the footer does, and /track finds the
 *      order by number + phone
 *   e. no horizontal scroll at 390px and 1440px, header icons aligned
 *   f. a product can be added to the cart AFTER the session exists - no 403
 *   g. the admin sign-in page still works
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
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
    try {
      await page.getByPlaceholder('Enter your full name').first().waitFor({ timeout: 60000 });
      /**
       * The endpoint refuses a form submitted less than three seconds after
       * the page rendered. A person cannot fill a name, a number and an email
       * that fast, so the test waits like a person would.
       */
      await page.waitForTimeout(5800);
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
  await page.waitForTimeout(500);

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: /^Continue$/ }).first().click();
    await page.waitForTimeout(4000);
    if (await page.locator('[data-contact-confirmed="yes"]').count()) return true;
    // The endpoint refuses a form that was submitted implausibly fast; wait
    // and try again.
    await page.waitForTimeout(3000);
  }
  return false;
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
  const continued = await continueWithContact(pageA, NAME, PHONE, EMAIL);
  await shot(pageA, 'a1-checkout-after-continue');

  check('a. Continue confirms the contact', continued);

  const cookies = await ctxA.cookies();
  const sessionCookie = cookies.find((c) => c.name === 'mv_customer_session');
  check('a. the session cookie is set', Boolean(sessionCookie));
  if (sessionCookie) {
    check('a. the cookie is httpOnly', sessionCookie.httpOnly === true);
    check('a. the cookie is SameSite=Lax', String(sessionCookie.sameSite).toLowerCase() === 'lax', sessionCookie.sameSite);
    check('a. the cookie is Secure in production', BASE.startsWith('https') ? sessionCookie.secure === true : true);
    const days = sessionCookie.expires ? Math.round((sessionCookie.expires * 1000 - Date.now()) / 86400000) : 0;
    check('a. the cookie lives for ~90 days', days > 80 && days <= 91, `${days} days`);
  }

  const accountIcon = await pageA.locator('header a[href="/account"], header [aria-label="My Profile"]').count();
  check('a. the header shows the profile icon', accountIcon > 0);

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
    await pageA.waitForTimeout(14000);
  }
  const orderUrl = pageA.url();
  check('a. the COD order is placed', /\/checkout\/success\//.test(orderUrl), orderUrl);
  await shot(pageA, 'a3-order-success');

  const successBody = (await pageA.textContent('body')) || '';
  const orderNumber = (successBody.match(/MV-\d+/) || [])[0] || '';
  check('a. the success page names the order', Boolean(orderNumber), orderNumber);

  // The success page links to /track for everybody.
  const successTrack = await pageA.locator(`a[href="/track"]`).count();
  check('d. the success page links to /track', successTrack > 0, `${successTrack} links`);

  /* ---------------------------------------------------------------- */
  /* f. Add to cart AFTER the session exists                          */
  /* ---------------------------------------------------------------- */
  const forbidden = [];
  const onResp = (r) => {
    if (r.status() === 403) forbidden.push(r.url());
  };
  pageA.on('response', onResp);
  await pageA.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  const cartBefore = (await pageA.locator('header a[href="/checkout"] span').first().textContent()) || '0';
  const addAfter = pageA.getByRole('button', { name: 'Add to Cart' }).first();
  await addAfter.waitFor({ timeout: 60000 });
  await addAfter.click();
  await pageA.waitForTimeout(3000);
  const cartAfter = (await pageA.locator('header a[href="/checkout"] span').first().textContent()) || '0';
  pageA.off('response', onResp);
  check('f. add to cart works after the session exists', Number(cartAfter) > Number(cartBefore), `${cartBefore} -> ${cartAfter}`);
  check('f. add to cart is never a 403', forbidden.length === 0, forbidden.slice(0, 2).join(' | '));
  const noCartLink = await pageA.locator('header a[href="/cart"]').count();
  check('f. the cart stayed in localStorage (no /cart page link)', noCartLink === 0);

  /* ---------------------------------------------------------------- */
  /* c. A visitor with no session                                      */
  /* ---------------------------------------------------------------- */
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageC = await ctxC.newPage();
  const errorsC = [];
  pageC.on('pageerror', (e) => errorsC.push(String(e.message)));

  await pageC.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageC.waitForTimeout(3500);
  const landed = pageC.url();
  check('c. /account does NOT send a visitor away', landed.replace(/\/+$/, '').endsWith('/account'), landed);
  const emptyBody = (await pageC.textContent('body')) || '';
  check('c. the empty state explains how a profile is created', /place an order to create your profile/i.test(emptyBody));
  const shopNow = await pageC.locator(`a[href="/products"]`).filter({ hasText: /shop now/i }).count();
  check('c. the empty state offers Shop Now', shopNow > 0);
  await shot(pageC, 'c1-no-session-empty-state');

  // The profile icon is always in the header and opens the same empty state.
  const headerIcon = pageC.locator('header a[href="/account"]').first();
  check('c. the header shows the profile icon without a session', (await headerIcon.count()) > 0);
  await headerIcon.click();
  await pageC.waitForTimeout(3000);
  const afterClick = pageC.url();
  const emptyAgain = /place an order to create your profile/i.test((await pageC.textContent('body')) || '');
  check('c. the icon opens the empty state once (no loop)', afterClick.replace(/\/+$/, '').endsWith('/account') && emptyAgain, afterClick);

  const loginLinks = await pageC.locator('a[href="/login"], a[href="/signup"], a[href="/forgot-password"]').count();
  check('c. there is no login or signup link anywhere', loginLinks === 0, `${loginLinks} found`);

  // /login and /signup answer a single 307 to / (no chain, no /login target).
  for (const route of ['/login', '/signup', '/forgot-password', '/reset-password']) {
    const res = await pageC.request.get(`${BASE}${route}`, { maxRedirects: 0 });
    const loc = res.headers()['location'] || '';
    const goesHome = loc === '/' || loc === `${BASE}/` || /^https?:\/\/[^/]+\/?$/.test(loc);
    check(`c. ${route} redirects once to /`, res.status() === 307 && goesHome, `${res.status()} -> ${loc}`);
  }

  const mobileIcon = await pageC.locator('header [aria-label="Toggle Navigation Menu"]').count();
  check('c. the mobile menu button is there', mobileIcon > 0);
  await shot(pageC, 'c2-no-session-header');

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

  await pageB.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(5000);
  const ordersB = (await pageB.textContent('body')) || '';
  check('b. the second browser does NOT show the first order', !orderNumber || !ordersB.includes(orderNumber), orderNumber);
  await shot(pageB, 'b3-second-browser-orders');

  /* ---------------------------------------------------------------- */
  /* a (continued). The first browser's own account                    */
  /* ---------------------------------------------------------------- */
  await pageA.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(4000);
  const bodyA = (await pageA.textContent('body')) || '';
  check('a. /account shows the profile name', bodyA.includes(NAME));
  check('a. /account shows the email', bodyA.toLowerCase().includes(EMAIL.toLowerCase()));
  check('a. /account shows the number', /72229\s*02273|7222902273/.test(bodyA.replace(/\s+/g, '')));
  await shot(pageA, 'a4-account-profile');

  await pageA.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
  // The list is fetched after the page arrives; wait for the card itself, so
  // the check reads the order and not the shell around it.
  try {
    await pageA.locator('main article').first().waitFor({ timeout: 25000 });
  } catch {
    /* reported by the checks below */
  }
  const ordersBody = (await pageA.textContent('body')) || '';
  const firstCard = (await pageA.locator('main article').first().textContent().catch(() => '')) || '';
  check('a. the order history shows the order', firstCard.includes(orderNumber) || ordersBody.includes(orderNumber), orderNumber || 'no number on the success page');
  /**
   * The status label. textContent joins the card's parts without spaces
   * ("…Order #MV-975675PendingDiwali…"), so no word boundary is assumed.
   */
  check(
    'a. the order shows its status',
    /(pending|processing|confirmed|placed|shipped|delivered)/i.test(firstCard),
    (firstCard.match(/(pending|processing|confirmed|placed|shipped|delivered)/i) || [])[0] || firstCard.slice(0, 80),
  );
  const historyTrack = await pageA.locator('main a[href="/track"]').count();
  check('d. the order history links to /track', historyTrack > 0, `${historyTrack} links`);
  await shot(pageA, 'a5-account-orders');

  // The detail page of the order that was just placed.
  const detailHref = await pageA.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/account/orders/"]'));
    const hit = links.find((a) => /MV-\d+/.test(a.textContent || '')) || links[0];
    return hit ? hit.getAttribute('href') : '';
  });
  if (detailHref) {
    await pageA.goto(`${BASE}${detailHref}`, { waitUntil: 'domcontentloaded' });
    await pageA.waitForTimeout(4000);
    const detailBody = (await pageA.textContent('body')) || '';
    check('a. the order detail page opens', detailBody.includes(orderNumber) || /order/i.test(detailBody), detailHref);
    await shot(pageA, 'a6-order-detail');
  } else {
    check('a. the order detail page opens', false, 'no order link in the history');
  }

  /* ---------------------------------------------------------------- */
  /* d. The navbar, and /track for everybody                          */
  /* ---------------------------------------------------------------- */
  const trackInHeader = await pageA.locator('header a[href="/track"]').count();
  check('d. the navbar has no "Track order"', trackInHeader === 0, `${trackInHeader} links`);
  const headerText = (await pageA.locator('header').textContent()) || '';
  check('d. the navbar has no "Track order" text', !/track order/i.test(headerText));

  // Open the mobile drawer too.
  await pageA.setViewportSize({ width: 390, height: 844 });
  await pageA.waitForTimeout(1200);
  await pageA.getByLabel('Toggle Navigation Menu').click();
  await pageA.waitForTimeout(1500);
  const drawerTrack = await pageA.locator('header nav a[href="/track"]').count();
  const drawerProfile = await pageA.locator('header nav a[href="/account"]').count();
  const headerIconMobile = await pageA.locator('header a[href="/account"]').count();
  check('d. the mobile menu has no "Track order"', drawerTrack === 0, `${drawerTrack} links`);
  check('d. the profile is in the mobile menu', drawerProfile > 0 && headerIconMobile > 0, `menu ${drawerProfile}, icon ${headerIconMobile}`);
  await shot(pageA, 'd1-mobile-menu');
  await pageA.setViewportSize({ width: 1440, height: 900 });
  await pageA.waitForTimeout(800);

  // The footer keeps it.
  await pageA.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(2500);
  const footTrack = await pageA.locator(`footer a[href="/track"]`).count();
  check('d. the footer links to /track', footTrack > 0, `${footTrack} links`);

  // /track finds the order by number + phone, without any session.
  const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageT = await ctxT.newPage();
  await pageT.goto(`${BASE}/track`, { waitUntil: 'domcontentloaded' });
  await pageT.waitForTimeout(2500);
  await pageT.locator('#orderRef').fill(orderNumber || 'MV-000000');
  await pageT.locator('#phone').fill(PHONE);
  await pageT.getByRole('button', { name: /track order/i }).first().click();
  await pageT.waitForTimeout(6000);
  const trackBody = (await pageT.textContent('body')) || '';
  const trackFound = (orderNumber && trackBody.includes(orderNumber)) || /pending|processing|placed|confirmed|delivered|shipped/i.test(trackBody);
  const trackFailed = /not found|no order|could not/i.test(trackBody) && !trackFound;
  check('d. /track finds the order with number + phone', trackFound && !trackFailed);
  await shot(pageT, 'd2-track-order');
  await ctxT.close();

  /* ---------------------------------------------------------------- */
  /* e. Layout: no horizontal scroll, header aligned                  */
  /* ---------------------------------------------------------------- */
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const ctxD = await browser.newContext({ viewport });
    const pageD = await ctxD.newPage();
    for (const url of ['/', '/products', '/account', '/account/orders', '/account/addresses', '/account/profile']) {
      await pageD.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
      await pageD.waitForTimeout(3000);
      const overflow = await horizontalOverflow(pageD);
      check(`e. no horizontal scroll on ${url} (${label})`, overflow <= 2, `${overflow}px`);
      await shot(pageD, `e-${label}${url.replace(/\//g, '-')}`);
    }

    // The profile icon sits on the same line as the cart icon.
    const boxes = await pageD.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, right: r.right };
      };
      return {
        cart: pick('header a[href="/checkout"]'),
        profile: pick('header a[href="/account"]'),
      };
    });
    if (boxes.cart && boxes.profile) {
      const gap = Math.abs((boxes.cart.top + boxes.cart.bottom) / 2 - (boxes.profile.top + boxes.profile.bottom) / 2);
      const left = boxes.profile.right <= boxes.cart.right + 200;
      check(`e. the profile icon is aligned with the cart (${label})`, gap <= 14 && left, `${Math.round(gap)}px apart`);
    } else {
      check(`e. the profile icon is aligned with the cart (${label})`, false, 'icons missing');
    }
    await ctxD.close();
  }

  /* ---------------------------------------------------------------- */
  /* b3. Logging out closes the session, not the account              */
  /* ---------------------------------------------------------------- */
  await pageA.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(3500);
  const beforeLogout = (await pageA.textContent('body')) || '';
  const logoutBtn = pageA.getByRole('button', { name: /^logout$/i }).first();
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await pageA.waitForTimeout(3500);
  }
  const afterLogoutCookies = await ctxA.cookies();
  const stillThere = afterLogoutCookies.find((c) => c.name === 'mv_customer_session');
  check('b. logout clears the session cookie', !stillThere, stillThere ? 'cookie still set' : 'cleared');
  check('b. logout happened from a real account page', /my profile|my orders/i.test(beforeLogout));

  // The area is closed now: same empty state, still no login page.
  await pageA.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(3500);
  const afterLogoutBody = (await pageA.textContent('body')) || '';
  check(
    'b. after logout /account is the empty state, not a login page',
    pageA.url().replace(/\/+$/, '').endsWith('/account') && /place an order to create your profile/i.test(afterLogoutBody),
    pageA.url(),
  );
  const logoutLoginLink = await pageA.locator('a[href="/login"], a[href="/signup"]').count();
  check('b. after logout there is still no login link', logoutLoginLink === 0, `${logoutLoginLink} found`);
  await shot(pageA, 'b4-after-logout');

  /* ---------------------------------------------------------------- */
  /* g. The admin sign-in still works                                  */
  /* ---------------------------------------------------------------- */
  // On production the admin is served under /admin by the same host. On
  // localhost it is a separate Vite app (npm run dev in admin/ -> :5174).
  const adminBase = process.env.ADMIN_BASE || (BASE.startsWith('https') ? `${BASE}/admin` : 'http://localhost:5174/');
  const adminRes = await pageC.goto(adminBase, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await pageC.waitForTimeout(5000);
  const adminBody = (await pageC.textContent('body').catch(() => '')) || '';
  check(
    'g. the admin sign-in page loads',
    Boolean(adminRes) && adminRes.status() === 200 && /admin portal/i.test(adminBody),
    `${adminBase} -> ${adminRes ? adminRes.status() : 'no response'}`,
  );
  await shot(pageC, 'g1-admin-login');

  check('a. no uncaught page errors during the run', errorsA.length === 0, errorsA.slice(0, 2).join(' | '));
  check('c. no uncaught page errors for the visitor', errorsC.length === 0, errorsC.slice(0, 2).join(' | '));

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
