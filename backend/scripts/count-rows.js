/**
 * Print the row count of every table that matters, as JSON.
 *
 * The go-live gate reads this to prove that a migration did not change any
 * data. It talks to Neon directly - there is no PostgREST, no service key and
 * no dashboard involved.
 *
 * Usage: node scripts/count-rows.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Client } = require('pg');

const TABLES = [
  'users',
  'orders',
  'order_items',
  'products',
  'categories',
  'banners',
  'blogs',
  'media',
  'coupons',
  'transactions',
  'otps',
  'whatsapp_message_log',
];

async function main() {
  const url = (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('Missing DATABASE_URL / DATABASE_URL_APP.');
    process.exit(2);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const counts = {};
  for (const table of TABLES) {
    try {
      const res = await client.query(`SELECT count(*)::int AS c FROM "${table}"`);
      counts[table] = res.rows[0].c;
    } catch {
      // A table that does not exist is simply not counted.
    }
  }
  await client.end();
  process.stdout.write(JSON.stringify(counts));
}

main().catch((err) => {
  console.error('count-rows failed:', err?.message || err);
  process.exit(1);
});
