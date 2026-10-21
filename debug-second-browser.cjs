const { chromium } = require('playwright');
const BASE = process.argv[2] || 'https://meruvedawellness.com';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageB = await ctxB.newPage();

  // Browser A
  await pageA.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(2000);
  await pageA.getByRole('button', { name: /add to cart/i }).first().click();
  await pageA.waitForTimeout(1200);
  await pageA.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(2500);
  await pageA.getByPlaceholder('Enter your full name').first().fill('First Customer');
  await pageA.locator('#checkout-mobile').first().fill('7222902273');
  await pageA.locator('#checkout-contact-email').first().fill('first@example.com');
  await pageA.waitForTimeout(1500);
  await pageA.getByRole('button', { name: /^Continue$/ }).first().click();
  await pageA.waitForTimeout(4000);

  // Browser B
  await pageB.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(2000);
  await pageB.getByRole('button', { name: /add to cart/i }).first().click();
  await pageB.waitForTimeout(1200);
  await pageB.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(2500);
  await pageB.getByPlaceholder('Enter your full name').first().fill('Someone Else');
  await pageB.locator('#checkout-mobile').first().fill('7222902273');
  await pageB.locator('#checkout-contact-email').first().fill('second@example.com');
  await pageB.waitForTimeout(1500);
  await pageB.getByRole('button', { name: /^Continue$/ }).first().click();
  await pageB.waitForTimeout(4000);

  console.log('=== Browser A /account ===');
  await pageA.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(5000);
  const bodyA = await pageA.textContent('body');
  console.log('  Has "First Customer":', bodyA.includes('First Customer'));
  console.log('  Has "Someone Else":', bodyA.includes('Someone Else'));

  console.log('\n=== Browser B /account ===');
  await pageB.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(5000);
  const bodyB = await pageB.textContent('body');
  console.log('  Has "Someone Else":', bodyB.includes('Someone Else'));
  console.log('  Has "First Customer":', bodyB.includes('First Customer'));
  console.log('  Body sample:', bodyB.slice(0, 300));

  await browser.close();
})();