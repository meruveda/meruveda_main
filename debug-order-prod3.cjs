const { chromium } = require('playwright');
const BASE = process.argv[2] || 'https://meruvedawellness.com';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    if (r.url().includes('/api/orders') || r.url().includes('/api/account/session')) {
      let body = '';
      try { body = (await r.text()).slice(0, 300); } catch {}
      console.log(`  [net] ${r.status()} ${r.url().replace(BASE, '')}  ${body}`);
    }
  });

  const NAME = 'Checkout Profile Tester';
  const PHONE = '7222902273';
  const EMAIL = 'production.checkout@example.com';

  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const add = page.getByRole('button', { name: /add to cart/i }).first();
  if (await add.count()) await add.click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder('Enter your full name').first().fill(NAME);
  await page.locator('#checkout-mobile').first().fill(PHONE);
  await page.locator('#checkout-contact-email').first().fill('production.checkout@example.com');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await page.waitForTimeout(4000);

  console.log('=== after Continue ===');
  const cookies = await ctx.cookies();
  console.log('  cookies:', cookies.map(c => c.name).join(', '));

  console.log('\n=== fill address ===');
  await page.waitForTimeout(500);
  await page.locator('#address-house').fill('12, Sunrise Residency');
  await page.locator('#address-area').fill('MG Road');
  await page.locator('#address-city').fill('Bengaluru');
  await page.locator('#address-pincode').fill('560001');
  const state = page.locator('#checkout-state');
  await state.click();
  await page.waitForTimeout(400);
  const option = page.getByRole('option', { name: /Karnataka/i }).first();
  if (await option.count()) {
    await option.click();
  } else {
    await state.fill('Karnataka');
    await page.waitForTimeout(400);
    await page.getByRole('option').first().click();
  }
  await page.waitForTimeout(400);

  console.log('\n=== click Place Order ===');
  const codRadio = page.getByText('Cash on Delivery', { exact: false }).first();
  if (await codRadio.count()) await codRadio.click();
  await page.waitForTimeout(600);

  const placeOrder = page.getByRole('button', { name: /place order/i }).first();
  console.log('  Place Order button found:', await placeOrder.count());
  console.log('  Place Order disabled:', await placeOrder.isDisabled());
  console.log('  Place Order text:', await placeOrder.textContent());

  const validation = await page.locator('text=/please|required|invalid/i').allTextContents();
  console.log('  validation messages:', validation);

  const form = placeOrder.locator('xpath=ancestor::form');
  console.log('  in form:', await form.count());

  const orderPromise = page.waitForResponse(r => r.url().includes('/api/orders') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);

  await placeOrder.click();
  console.log('  clicked Place Order');

  const orderResponse = await orderPromise;
  if (orderResponse) {
    console.log('  order response:', orderResponse.status(), await orderResponse.text().then(t => t.slice(0, 300)).catch(() => ''));
  } else {
    console.log('  NO order response within 15s');
  }

  await page.waitForTimeout(15000);
  console.log('  final URL:', page.url());
  console.log('  errors:', errors.slice(0, 5));
  await browser.close();
})();