/**
 * DRY-RUN ONLY — phone-auth migration audit.
 *
 * Counts users with/without a usable phone number and reports duplicate
 * normalized numbers. Makes NO writes. Do NOT run a real migration on
 * production without reviewing this output first.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-phone-migration.js
 */
const { createClient } = require('@supabase/supabase-js');

const digitsOnly = (v) => String(v || '').replace(/\D/g, '');
const normalizePhone10 = (raw) => {
  if (!raw) return '';
  let d = digitsOnly(raw);
  if (d.length === 13 && d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
};
const isValidPhone10 = (raw) => /^[6-9]\d{9}$/.test(normalizePhone10(raw));
const PLACEHOLDER_DOMAIN = 'meruveda.whatsapp';
const isPlaceholderEmail = (email) =>
  !email || String(email).trim().toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const PAGE = 1000;
  let from = 0;
  let total = 0;
  let withValidPhone = 0;
  let withoutPhone = 0;
  let withInvalidPhone = 0;
  let emailOnlyNoPhone = 0;
  let phoneOnlyPlaceholderEmail = 0;
  const byPhone = new Map();
  const missingPhoneSample = [];

  for (;;) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, phone, role, created_at')
      .range(from, from + PAGE - 1)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const u of data) {
      total += 1;
      const valid = isValidPhone10(u.phone);
      if (valid) {
        withValidPhone += 1;
        const n = normalizePhone10(u.phone);
        if (!byPhone.has(n)) byPhone.set(n, []);
        byPhone.get(n).push({ id: u.id, email: u.email, role: u.role });
      } else if (!u.phone || !digitsOnly(u.phone)) {
        withoutPhone += 1;
        if (!isPlaceholderEmail(u.email)) emailOnlyNoPhone += 1;
        if (missingPhoneSample.length < 10)
          missingPhoneSample.push({ id: u.id, email: u.email, role: u.role });
      } else {
        withInvalidPhone += 1;
      }
      if (isPlaceholderEmail(u.email) && valid) phoneOnlyPlaceholderEmail += 1;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const duplicates = [...byPhone.entries()].filter(([, owners]) => owners.length > 1);

  console.log('--- Phone-auth migration dry run (READ ONLY, no writes) ---');
  console.log(`Total users:                 ${total}`);
  console.log(`With valid phone (login OK): ${withValidPhone}`);
  console.log(`Without any phone:           ${withoutPhone}`);
  console.log(`  of which email-only:       ${emailOnlyNoPhone} (need add-and-verify-phone prompt)`);
  console.log(`With malformed phone:        ${withInvalidPhone}`);
  console.log(`Phone-only (placeholder email): ${phoneOnlyPlaceholderEmail}`);
  console.log(`Duplicate normalized phones: ${duplicates.length}`);
  for (const [phone, owners] of duplicates.slice(0, 20)) {
    console.log(`  ${phone}: ${owners.map((o) => `${o.id} (${o.email}, ${o.role})`).join(' | ')}`);
  }
  if (missingPhoneSample.length) {
    console.log('Sample users missing phone (first 10):');
    for (const s of missingPhoneSample) console.log(`  ${s.id} ${s.email} [${s.role}]`);
  }
  console.log('Migration path: phone users log in immediately; email-only users keep');
  console.log('email+password fallback once and are asked to add/verify a phone number.');
}

main().catch((e) => {
  console.error('Audit failed:', e?.message || e);
  process.exit(1);
});
