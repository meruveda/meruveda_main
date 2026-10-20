/** Temporary diagnostic: dump every image-bearing column so the mapping can be built. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
import { many } from '../../src/database/db';

async function main() {
  const cols = await many(
    `SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='media'
      ORDER BY ordinal_position`,
  );
  console.log(JSON.stringify(cols, null, 2));
  const cons = await many(
    `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = 'public.media'::regclass`,
  );
  console.log(JSON.stringify(cons, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
