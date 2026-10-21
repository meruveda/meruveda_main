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
    if (r.url().includes('/api/orders/my')) {
      let body = '';
      try { body = (await r.text()).slice(0, 300); } catch {}
      console.log(`  [net] ${r.status()} ${r.url().replace(BASE, '')}  ${body}`);
    }
  });

  const NAME = 'Checkout Profile Tester';
  const PHONE = '7222902273';

  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const add = page.getByRole('button', { name: /add to cart/i }).first();
  if (await add.count()) await add.click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder('Enter your full name').first().fill(NAME);
  await page.locator('#checkout-mobile').first().fill('7222902273');
  await page.locator('#checkout-contact-email').first().fill('production.checkout@example.com');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await page.waitForTimeout(4000);

  // Fill address
  await page.locator('#address-house').fill('12, Sunrise Residency');
  await page.locator('#address-area').fill('MG Road');
  await page.locator('#address-city').fill('Bengaluru');
  await page.locator('#address-pincode').fill('560001');
  const state = page.locator('#checkout-state');
  await state.click();
  await page.waitForTimeout(400);
  const option = page.getByRole('option', { name: /Karnataka/i }).first();
  if (await option.count()) await option.click();
  else { await state.fill('Karnataka'); await page.waitForTimeout(400); await page.getByRole('option').first().click(); }
  await page.waitForTimeout(400);

  // Place COD order
  const codRadio = page.getByText('Cash on Delivery', { exact: false }).first();
  if (await codRadio.count()) await codRadio.click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /place order/i }).first().click();
  await page.waitForTimeout(15000);

  // Get the order ID from the success URL
  const successUrl = page.url();
  console.log('Success URL:', successUrl);
  const orderId = successUrl.split('/checkout/success/')[1]?.split('/')[0];
  console.log('Order ID:', orderId);

  console.log('\n=== check order history ===');
  await page.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // Check the API response
  const orderHistoryBody = (await page.textContent('body')) || '';
  console.log('Order history body (first 500 chars):', orderHistoryBody.slice(0, 500));
  console.log('\n  Has MV- pattern:', /MV-\d+/i.test(orderHistoryBody));

  // Also check the API directly
  const apiResponse = await page.request.get(`${BASE}/api/orders/my`, {
    headers: { 'Authorization': `Bearer ${(await ctx.cookies()).find(c => c.name === 'meruveda_auth_token')?.value || ''}` }
  });
  const apiBody = await apiResponse.text();
  console.log('API /orders/my:', apiBody.slice(0, 500));

  await browser.close();
})();