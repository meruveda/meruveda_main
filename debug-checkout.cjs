const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes('/api/account/session') || u.includes('/api/cart')) {
      let body = '';
      try { body = (await r.text()).slice(0, 220); } catch {}
      console.log(`  [net] ${r.status()} ${u}  ${body}`);
    }
  });

  console.log('=== 1. the notice on /?profile=required ===');
  await page.goto(`${BASE}/?profile=required`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const body = (await page.textContent('body')) || '';
  console.log('  notice present:', /place an order to create your profile/i.test(body));
  console.log('  url:', page.url());

  console.log('\n=== 2. the checkout: add to cart, fill, Continue ===');
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const add = page.getByRole('button', { name: /add to cart/i }).first();
  console.log('  add-to-cart buttons:', await add.count());
  if (await add.count()) await add.click();
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('  cart items in localStorage:', await page.evaluate(() => localStorage.getItem('meruveda_cart')));
  const nameInput = page.getByPlaceholder('Enter your full name').first();
  console.log('  the name field is there:', (await nameInput.count()) > 0);
  if (await nameInput.count()) {
    await nameInput.fill('Debug Customer');
    await page.locator('#checkout-mobile').first().fill('7222902273');
    await page.locator('#checkout-contact-email').first().fill('debug.customer@example.com');
    await page.waitForTimeout(500);
    const cont = page.getByRole('button', { name: /^Continue$/ }).first();
    console.log('  the Continue button:', await cont.count());
    await cont.click();
    await page.waitForTimeout(4000);
    console.log('  confirmed:', await page.locator('[data-contact-confirmed="yes"]').count());
    const err = await page.locator('text=/could not|error|invalid|required/i').allTextContents();
    console.log('  messages on the page:', err.slice(0, 4));
  }

  console.log('\n  errors:', errors.slice(0, 6));
  await browser.close();
})();
