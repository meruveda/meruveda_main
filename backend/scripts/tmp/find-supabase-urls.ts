/**
 * Find every Supabase URL in the database.
 *
 * The Supabase project is suspended (HTTP 402), so every one of these URLs is
 * a broken image on the live site. This finds them all, per table and column,
 * so nothing is missed.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main(): Promise<void> {
  const client = new Client({
    connectionString: (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim(),
  });
  await client.connect();

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  );

  let grandTotal = 0;
  for (const t of tables.rows) {
    const table = t.table_name;
    const cols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = $1 AND data_type IN ('text','character varying','jsonb','json')
        ORDER BY ordinal_position`,
      [table],
    );
    for (const c of cols.rows) {
      const col = c.column_name;
      const expr = c.data_type === 'jsonb' || c.data_type === 'json'
        ? `"${col}"::text`
        : `"${col}"`;
      try {
        const r = await client.query(
          `SELECT count(*)::int AS n FROM "${table}" WHERE ${expr} LIKE '%supabase.co%'`,
        );
        if (r.rows[0].n > 0) {
          console.log(`  ${table}.${col}: ${r.rows[0].n}`);
          grandTotal += r.rows[0].n;
        }
      } catch (e: any) {
        // A column that cannot be cast to text is not a URL holder.
      }
    }
  }
  console.log(`\nTOTAL cells containing a Supabase URL: ${grandTotal}`);

  await client.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
