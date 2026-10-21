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
  const EMAIL = 'checkout.profile@example.com';

  console.log('=== 1. open session ===');
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const add = page.getByRole('button', { name: /add to cart/i }).first();
  console.log('  add-to-cart buttons:', await add.count());
  if (await add.count()) await add.click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder('Enter your full name').first().fill(NAME);
  await page.locator('#checkout-mobile').first().fill(PHONE);
  await page.locator('#checkout-contact-email').first().fill('production.checkout@example.com');
  await page.waitForTimeout(1500);
  const cont = page.getByRole('button', { name: /^Continue$/ }).first();
  await cont.click();
  await page.waitForTimeout(4000);
  console.log('  confirmed:', await page.locator('[data-contact-confirmed="yes"]').count());
  console.log('  cookies:', (await ctx.cookies()).map((c) => c.name).join(', '));

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
  console.log('  address filled');

  console.log('\n=== place COD order ===');
  const codRadio = page.getByText('Cash on Delivery', { exact: false }).first();
  console.log('  COD radio found:', await codRadio.count());
  if (await codRadio.count()) await codRadio.click();
  await page.waitForTimeout(600);

  const placeOrder = page.getByRole('button', { name: /place order/i }).first();
  console.log('  Place Order button found:', await placeOrder.count());
  console.log('  Place Order disabled:', await placeOrder.isDisabled());
  if (await placeOrder.count()) {
    await placeOrder.click();
    await page.waitForTimeout(15000);
  }
  console.log('  final URL:', page.url());
  console.log('  errors:', errors.slice(0, 4));

  await browser.close();
})();