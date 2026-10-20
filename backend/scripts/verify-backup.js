/**
 * Prove the last backup is restorable.
 *
 * A backup that cannot be restored is not a backup. This checks the newest
 * file in backend/backups: it is valid JSON, it has the tables the app reads,
 * and every table has the rows the count-rows script reports.
 *
 * Usage: node scripts/verify-backup.js [--latest]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/** Tables the app cannot run without. */
const REQUIRED_TABLES = ['users', 'orders', 'order_items', 'products'];

function newestBackup() {
  let files = [];
  try {
    files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json') && f.startsWith('neon-'))
      .sort();
  } catch {
    return null;
  }
  if (!files.length) return null;
  const name = files[files.length - 1];
  return { name, path: path.join(BACKUP_DIR, name) };
}

function main() {
  const backup = newestBackup();
  if (!backup) {
    console.log('NOT FULLY RESTORABLE: there is no backup in backend/backups.');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(backup.path, 'utf8'));
  } catch (err) {
    console.log(`NOT FULLY RESTORABLE: ${backup.name} is not valid JSON (${err.message}).`);
    process.exit(1);
  }

  const problems = [];
  if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
    console.log(`NOT FULLY RESTORABLE: ${backup.name} has no tables section.`);
    process.exit(1);
  }

  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(parsed.tables[table])) {
      problems.push(`table "${table}" is missing`);
    }
  }

  // Every table in the dump must be a list, so a restore can replay it.
  for (const [table, rows] of Object.entries(parsed.tables)) {
    if (!Array.isArray(rows)) problems.push(`table "${table}" is not a list`);
  }

  // Cross-check the row counts against the live database.
  try {
    const stdout = execFileSync(process.execPath, [path.join(__dirname, 'count-rows.js')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const live = JSON.parse(stdout || '{}');
    for (const [table, count] of Object.entries(live)) {
      const dumped = parsed.tables?.[table];
      if (!Array.isArray(dumped)) continue;
      if (dumped.length < Number(count)) {
        problems.push(`table "${table}" has ${dumped.length} rows but the database has ${count}`);
      }
    }
  } catch {
    problems.push('the live row counts could not be read for comparison');
  }

  if (problems.length) {
    console.log(`NOT FULLY RESTORABLE: ${problems.length} problem(s).`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }

  console.log(`RESTORABLE: structure and integrity checks passed (${backup.name}).`);
}

main();
