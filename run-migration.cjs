const { neon } = require('C:/Users/Acer/Desktop/meruveda-main/node_modules/@neondatabase/serverless/index.js');
const fs = require('fs');

const env = fs.readFileSync('./backend/.env', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    await sql`ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;`;
    console.log('Migration applied: orders.user_id is now nullable');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();