/**
 * `npm run db:verify` — compare the live Neon schema against the committed
 * expectation file and FAIL when they disagree.
 *
 * Expected objects live in database/neon/expected-schema.json (tables +
 * columns + types, non-extension functions, indexes). Anything listed there
 * and missing from information_schema is an error; objects present in the
 * database but not listed are reported as drift.
 *
 * Unlike the old Supabase probe this needs the database itself (it reads
 * information_schema), so run it where backend/.env is available — locally,
 * in CI with a Neon branch, or against preview.
 *
 * Usage:
 *   node scripts/db-verify.js            verify (exit 1 on mismatch)
 *   node scripts/db-verify.js --emit     print the current schema as JSON
 *   node scripts/db-verify.js --json     machine-readable result on stdout
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_FILE = path.join(__dirname, '..', 'database', 'neon', 'expected-schema.json');
const argv = process.argv.slice(2);
const emit = argv.includes('--emit');
const jsonOut = argv.includes('--json');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

async function snapshot(client) {
  const tables = {};
  const tableRows = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  for (const t of tableRows.rows) {
    const cols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [t.table_name],
    );
    const columns = {};
    for (const c of cols.rows) columns[c.column_name] = c.data_type;
    tables[t.table_name] = { columns };
  }

  const fnRows = await client.query(`
    SELECT p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.deptype = 'e')
     ORDER BY 1`);

  const idxRows = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY indexname`,
  );

  return {
    tables,
    functions: fnRows.rows.map((r) => r.proname),
    indexes: idxRows.rows.map((r) => r.indexname),
  };
}

function diff(expected, actual) {
  const missing = { tables: [], columns: [], types: [], functions: [], indexes: [] };
  const unexpected = { tables: [], columns: [], functions: [], indexes: [] };

  for (const [table, spec] of Object.entries(expected.tables || {})) {
    const live = actual.tables[table];
    if (!live) {
      missing.tables.push(table);
      continue;
    }
    for (const [column, type] of Object.entries(spec.columns || {})) {
      if (!(column in live.columns)) {
        missing.columns.push(`${table}.${column}`);
      } else if (live.columns[column] !== type) {
        missing.types.push(`${table}.${column}: expected ${type}, found ${live.columns[column]}`);
      }
    }
    for (const column of Object.keys(live.columns)) {
      if (!(column in (spec.columns || {}))) unexpected.columns.push(`${table}.${column}`);
    }
  }
  for (const table of Object.keys(actual.tables)) {
    if (!(table in (expected.tables || {}))) unexpected.tables.push(table);
  }

  for (const fn of expected.functions || []) {
    if (!actual.functions.includes(fn)) missing.functions.push(fn);
  }
  for (const fn of actual.functions) {
    if (!(expected.functions || []).includes(fn)) unexpected.functions.push(fn);
  }

  for (const idx of expected.indexes || []) {
    if (!actual.indexes.includes(idx)) missing.indexes.push(idx);
  }
  for (const idx of actual.indexes) {
    if (!(expected.indexes || []).includes(idx)) unexpected.indexes.push(idx);
  }

  return { missing, unexpected };
}

function isEmpty(diffSet) {
  return Object.values(diffSet).every((list) => list.length === 0);
}

async function main() {
  loadDotEnv();
  const { Client } = require('pg');
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('Missing DATABASE_URL — set it in backend/.env to verify the schema.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const actual = await snapshot(client);

    if (emit) {
      process.stdout.write(JSON.stringify(actual, null, 2) + '\n');
      return;
    }

    if (!fs.existsSync(EXPECTED_FILE)) {
      console.error(`Missing expectation file: ${path.relative(process.cwd(), EXPECTED_FILE)}`);
      console.error('Generate it with: node scripts/db-verify.js --emit > database/neon/expected-schema.json');
      process.exit(1);
    }

    const expected = JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8'));
    const { missing, unexpected } = diff(expected, actual);

    const counts = Object.values(missing).reduce((n, list) => n + list.length, 0);
    const unexpectedCount = Object.values(unexpected).reduce((n, list) => n + list.length, 0);

    if (jsonOut) {
      process.stdout.write(JSON.stringify({ ok: counts === 0, missing, unexpected }, null, 2) + '\n');
    } else {
      console.log(
        `db:verify -> ${Object.keys(actual.tables).length} tables, ` +
          `${actual.functions.length} functions, ${actual.indexes.length} indexes checked ` +
          `against ${path.basename(EXPECTED_FILE)}`,
      );
      if (counts > 0) {
        for (const [kind, list] of Object.entries(missing)) {
          for (const item of list) console.error(`  MISSING ${kind}: ${item}`);
        }
        console.error(`Schema MISMATCH: ${counts} missing object(s).`);
        console.error('Fix it with a new additive migration: npm run db:migrate');
      }
      if (unexpectedCount > 0) {
        for (const [kind, list] of Object.entries(unexpected)) {
          for (const item of list) console.warn(`  unexpected ${kind}: ${item} (add it to the expectation file if intended)`);
        }
      }
      if (counts === 0) console.log('Schema matches the expectation file.');
    }

    process.exit(counts === 0 ? 0 : 1);
  } catch (err) {
    console.error(`db:verify failed: ${err?.message || err}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main();
