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
    if (r.url().includes('/api/account/session') || r.url().includes('/api/orders/my')) {
      let body = '';
      try { body = (await r.text()).slice(0, 200); } catch {}
      console.log(`  [net] ${r.status()} ${r.url().replace(BASE, '')}  ${body}`);
    }
  });

  // Open a session.
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const add = page.getByRole('button', { name: /add to cart/i }).first();
  if (await add.count()) await add.click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder('Enter your full name').first().fill('Debug Customer');
  await page.locator('#checkout-mobile').first().fill('7222902273');
  await page.locator('#checkout-contact-email').first().fill('debug.customer@example.com');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await page.waitForTimeout(3500);

  console.log('=== after Continue ===');
  console.log('  localStorage token:', (await page.evaluate(() => localStorage.getItem('meruveda_auth_token')) || '').slice(0, 40));
  console.log('  localStorage user :', (await page.evaluate(() => localStorage.getItem('meruveda_user')) || '').slice(0, 160));
  const cookies = await ctx.cookies();
  console.log('  cookies:', cookies.map((c) => `${c.name}(httpOnly=${c.httpOnly},sameSite=${c.sameSite},${c.domain})`).join(', ') || 'none');

  console.log('\n=== /account ===');
  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('  url:', page.url());
  const body = (await page.textContent('body')) || '';
  console.log('  has the name:', body.includes('Debug Customer'));
  console.log('  has the email:', body.includes('debug.customer@example.com'));
  console.log('  has the phone:', body.includes('7222902273'));
  console.log('  body head:', body.replace(/\s+/g, ' ').slice(0, 400));
  console.log('  errors:', errors.slice(0, 5));
  await browser.close();
})();
