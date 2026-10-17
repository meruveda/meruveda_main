/**
 * WhatsApp Cloud API credential, phone number and template validator.
 *
 * Answers, without guessing:
 *   1. Is WHATSAPP_API_TOKEN a valid, live Meta token?
 *   2. Is WHATSAPP_PHONE_NUMBER_ID really a WhatsApp Business phone number id,
 *      and which number is behind it?
 *   3. Which message templates actually exist on the account, what are their
 *      approval statuses, languages and body-variable counts?
 *   4. Does the template the code hardcodes (whatsappService.ts WHATSAPP_TEMPLATES.OTP)
 *      exist and is it APPROVED? If not, OTP sends cannot succeed.
 *   5. Optionally send one real test message to ADMIN_WHATSAPP_NUMBER.
 *
 * The token is never printed. Recipient must already exist in the environment -
 * nothing is hardcoded.
 *
 * Usage:
 *   node scripts/verify-whatsapp.js
 *   node scripts/verify-whatsapp.js --send      send a test template message
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const OTP_TEMPLATE = 'otp_verification';

const token = process.env.WHATSAPP_API_TOKEN || '';
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const testRecipient = process.env.ADMIN_WHATSAPP_NUMBER || '';

const looksPlaceholder = !token || token === 'PLACEHOLDER_TOKEN' || /^your-/i.test(token);

async function api(path, init = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Strip anything that could identify a customer; keep Meta's error contract. */
function sanitize(json) {
  const e = json?.error;
  if (!e) return null;
  return {
    code: e.code,
    type: e.type,
    subcode: e.error_subcode ?? undefined,
    message: e.message,
    fbtrace_id: e.fbtrace_id,
  };
}

function line(ok, label, detail) {
  console.log(`  ${ok === null ? '?     ' : ok ? 'OK    ' : 'FAIL  '} ${label}${detail ? `  ${detail}` : ''}`);
  return ok;
}

async function main() {
  const send = process.argv.includes('--send');
  console.log(`Graph API version : ${API_VERSION}\n`);

  if (looksPlaceholder) {
    console.log('FAIL  WHATSAPP_API_TOKEN is still a placeholder in backend/.env');
    console.log('      Set it to a real Meta access token, then re-run this script.');
    console.log('      Nothing else can be validated until then.');
    process.exit(1);
  }

  // ---- 1. Token liveness -------------------------------------------------
  const me = await api('/me?fields=id,name');
  const tokenOk = line(me.status === 200, 'Token accepted by Graph API',
    me.status === 200 ? `token owner id=${me.json.id}` : '');

  // ---- 2. Debug token (scopes + expiry) ----------------------------------
  const dbg = await api(`/debug_token?input_token=${encodeURIComponent(token)}`);
  if (dbg.status === 200 && dbg.json?.data) {
    const d = dbg.json.data;
    console.log(`        scopes   : ${(d.scopes || []).join(', ') || '(none reported)'}`);
    console.log(`        expires  : ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'never'}`);
    if (d.is_valid === false) line(false, 'debug_token reports the token as invalid', d.error?.message || '');
  } else {
    console.log(`        debug_token unavailable (${dbg.status}) - needs app_access_token`);
  }

  if (!phoneId) {
    line(false, 'WHATSAPP_PHONE_NUMBER_ID', 'not set');
    process.exit(1);
  }

  // ---- 3. Phone number identity ------------------------------------------
  const num = await api(`/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status`);
  if (num.status === 200) {
    const n = num.json;
    line(true, 'Phone number ID resolves',
      `display=${n.display_phone_number || '?'} name=${n.verified_name || '(unverified)'} status=${n.code_verification_status || '?'} quality=${n.quality_rating || '?'}`);
    if (n.name_status && n.name_status !== 'APPROVED') {
      console.log(`        NOTE: business name status is ${n.name_status}. Templates may still send,`);
      console.log('              but new template submissions are limited until it is approved.');
    }
  } else {
    line(false, 'Phone number ID resolves', JSON.stringify(sanitize(num.json)));
  }

  // ---- 4. Business account + template inventory ---------------------------
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (wabaId) {
    const tpl = await api(`/${wabaId}/message_templates?fields=name,status,language,category,parameter_count`);
    if (tpl.status === 200 && Array.isArray(tpl.json.data)) {
      console.log(`\n  Templates on WABA ${wabaId}:`);
      for (const t of tpl.json.data) {
        console.log(`    - ${String(t.name).padEnd(28)} ${String(t.status).padEnd(10)} ${t.language}  params=${t.parameter_count ?? '?'}  ${t.category || ''}`);
      }
    } else {
      console.log(`\n  Template list failed: ${JSON.stringify(sanitize(tpl.json))}`);
    }
  } else {
    console.log('\n  WHATSAPP_BUSINESS_ACCOUNT_ID is not set - cannot list templates.');
  }

  // ---- 4. Does the hardcoded OTP template line up? -----------------------
  console.log(`\n  The code sends template name "${OTP_TEMPLATE}" (whatsappService.ts WHATSAPP_TEMPLATES.OTP)`);
  console.log('  with language "en" and exactly 2 body params: {{1}} = code, {{2}} = TTL minutes.');

  // Send is gated on this outcome: firing at Meta with an unapproved or
  // mis-shaped template just burns the customer's 45s resend cooldown and
  // proves nothing. Nothing is sent until the template is confirmed usable.
  let templateReady = false;
  let templateDetail = 'template inventory unavailable (WHATSAPP_BUSINESS_ACCOUNT_ID not set)';

  if (!wabaId) {
    line(false, 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'not set — cannot verify the template, so --send is blocked');
  } else {
    const tpl = await api(`/${wabaId}/message_templates?fields=name,status,language,parameter_count`);
    const list = tpl.json?.data || [];
    const match = list.find((t) => t.name === OTP_TEMPLATE);
    if (!match) {
      line(false, `Template "${OTP_TEMPLATE}" exists`, 'no template with that exact name');
      templateDetail =
        `No template named "${OTP_TEMPLATE}". Approved templates on this account: ` +
        (list.length ? list.map((t) => `"${t.name}" (${t.status})`).join(', ') : 'none listed');
    } else {
      const approved = match.status === 'APPROVED';
      line(approved, `Template "${OTP_TEMPLATE}" is APPROVED`, `status=${match.status} lang=${match.language} params=${match.parameter_count}`);
      const problems = [];
      if (!approved) problems.push(`status is ${match.status}, not APPROVED`);
      if (Number(match.parameter_count) !== 2) problems.push(`declares ${match.parameter_count} variables, code sends 2`);
      if (match.language !== 'en') problems.push(`language is "${match.language}", code sends "en"`);
      if (problems.length) {
        templateDetail = `Template "${OTP_TEMPLATE}" is not usable: ${problems.join('; ')}`;
        console.log(`        BLOCKING: ${templateDetail}`);
      } else {
        templateReady = true;
        templateDetail = `${OTP_TEMPLATE} approved, en, 2 variables`;
      }
    }
  }

  // ---- 6. Optional real send ---------------------------------------------
  if (send) {
    if (!templateReady) {
      console.log('\n  NOT SENDING. --send requires a confirmed, APPROVED template first.');
      console.log(`  Reason: ${templateDetail}`);
      console.log('  Set WHATSAPP_BUSINESS_ACCOUNT_ID, fix the template in Meta Business Manager,');
      console.log('  then re-run. Nothing was sent and no cooldown was consumed.');
      process.exitCode = 1;
    } else if (!testRecipient) {
      line(false, 'ADMIN_WHATSAPP_NUMBER', 'not set - refusing to guess a recipient');
      process.exitCode = 1;
    } else {
      const res = await api(`/${phoneId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: testRecipient,
          type: 'template',
          template: {
            name: OTP_TEMPLATE,
            language: { code: 'en' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: '123456' }, { type: 'text', text: '5' }] }],
          },
        }),
      });
      const wamid = res.json?.messages?.[0]?.id;
      line(res.status === 200, 'Test template message accepted by Meta',
        res.status === 200 ? `wamid=${wamid}` : JSON.stringify(sanitize(res.json)));
      if (res.status === 200) console.log(`        check WhatsApp on +${testRecipient} - it should arrive in seconds.`);
    }
  } else {
    console.log('\n  Re-run with --send to deliver one real test message to ADMIN_WHATSAPP_NUMBER.');
    console.log('  (--send refuses to fire unless the template above is APPROVED and correctly shaped.)');
  }

  void tokenOk;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});