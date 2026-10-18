/**
 * WhatsApp Cloud API credential, phone number and template validator.
 *
 * Answers, without guessing:
 *   1. Is the WhatsApp token a valid, live Meta token?
 *   2. Is WHATSAPP_PHONE_NUMBER_ID really a WhatsApp Business phone number id,
 *      and which number is behind it?
 *   3. Which message templates actually exist on the account, what are their
 *      approval statuses, languages, categories and body-variable counts?
 *   4. Does WHATSAPP_OTP_TEMPLATE_NAME exist, is it APPROVED, is its category
 *      AUTHENTICATION and is its language exactly WHATSAPP_TEMPLATE_LANG?
 *   5. When WHATSAPP_INVOICE_ENABLED=true, the same three questions for
 *      WHATSAPP_INVOICE_TEMPLATE_NAME.
 *   6. Optionally send one real test message to ADMIN_WHATSAPP_NUMBER.
 *
 * Template names and languages come from the environment ONLY — nothing is
 * hardcoded, so this script validates exactly what the app will send.
 *
 * The token is never printed. Recipient must already exist in the environment.
 *
 * Exit code: 0 when every check passed, 1 otherwise.
 *
 * Usage:
 *   node scripts/verify-whatsapp.js
 *   node scripts/verify-whatsapp.js --send      send a test template message
 *   node scripts/verify-whatsapp.js --json      machine-readable result line
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

// ---- Everything below is read from the environment only ---------------------
const token = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN || '';
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const testRecipient = process.env.ADMIN_WHATSAPP_NUMBER || '';
const OTP_TEMPLATE = (process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
const TEMPLATE_LANG = (process.env.WHATSAPP_TEMPLATE_LANG || '').trim();
const INVOICE_ENABLED = process.env.WHATSAPP_INVOICE_ENABLED === 'true';
const INVOICE_TEMPLATE = (
  process.env.WHATSAPP_INVOICE_TEMPLATE_NAME ||
  process.env.INVOICE_WA_TEMPLATE_NAME ||
  ''
).trim();

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

/** Emit the machine-readable result line go-live.js reads. Contains no secrets. */
function emitJson(partial) {
  console.log(`GO_LIVE_JSON ${JSON.stringify({ allOk: false, ...partial })}`);
}

async function main() {
  const send = process.argv.includes('--send');
  console.log(`Graph API version : ${API_VERSION}\n`);

  if (looksPlaceholder) {
    console.log('FAIL  WHATSAPP_API_TOKEN is still a placeholder in backend/.env');
    console.log('      Set it to a real Meta access token, then re-run this script.');
    console.log('      Nothing else can be validated until then.');
    emitJson({ token: false, waba: false, phoneId: false, otpTemplate: false, missing: 'WHATSAPP_API_TOKEN or WHATSAPP_TOKEN' });
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
    emitJson({
      token: Boolean(tokenOk),
      waba: false,
      phoneId: false,
      otpTemplate: false,
      missing: 'WHATSAPP_PHONE_NUMBER_ID',
    });
    process.exit(1);
  }

  // ---- 3. Phone number identity ------------------------------------------
  const num = await api(`/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status`);
  let phoneOk = false;
  if (num.status === 200) {
    phoneOk = true;
    const n = num.json;
    line(true, 'Phone number ID resolves',
      `display=${n.display_phone_number || '?'} name=${n.verified_name || '(unverified)'} status=${n.code_verification_status || '?'} quality=${n.quality_rating || '?'}`);
    if (n.name_status && n.name_status !== 'APPROVED') {
      console.log(`        NOTE: business name status is ${n.name_status}. Templates may still send,`);
      console.log('              but new template submissions are limited until it is approved.');
    }
  } else {
    const e = num.json?.error || {};
    line(false, 'Phone number ID resolves', `code=${e.code} subcode=${e.error_subcode ?? '-'} ${e.message || ''}`);
    if (e.code === 100) {
      console.log('');
      console.log('        This means the access token cannot see that Phone Number ID at all.');
      console.log('        Either the id is wrong, or the System User it belongs to has no');
      console.log('        WhatsApp Business Account assigned. Both must be fixed in Meta:');
      console.log('          1. Correct id: Meta Business Manager -> WhatsApp -> Phone numbers ->');
      console.log('             your number -> API Setup -> "Phone number ID"');
      console.log('          2. Assignment: Business Settings -> Users -> System Users -> your');
      console.log('             employee -> Assign Assets -> WhatsApp Business Account');
      console.log('        Do not guess the id: a wrong one fails every send with error 100.');
    }
  }

  // ---- 4. Business account + template inventory ---------------------------
  // The WABA id is usually not recorded locally, but it is reachable from the
  // phone number id, so it can be derived rather than asked for.
  let wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!wabaId) {
    const acct = await api(`/${phoneId}/whatsapp_business_account?fields=id,name`);
    if (acct.status === 200 && acct.json?.id) {
      wabaId = String(acct.json.id);
      console.log(`\n  Derived WHATSAPP_BUSINESS_ACCOUNT_ID from the phone number: ${wabaId}`);
      if (acct.json.name) console.log(`  Business account name: ${acct.json.name}`);
      console.log('  (set it in backend/.env so this lookup is not needed at runtime)');
    } else {
      console.log(`\n  Could not derive a business account id: ${JSON.stringify(sanitize(acct.json))}`);
    }
  }

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

  // ---- 4. Templates must line up with what the code will actually send -----
  console.log(
    `\n  The code sends template name "${OTP_TEMPLATE || '(unset)'}" ` +
      `(WHATSAPP_OTP_TEMPLATE_NAME) with language "${TEMPLATE_LANG || '(unset)'}" ` +
      `(WHATSAPP_TEMPLATE_LANG).`
  );
  console.log('  It is an AUTHENTICATION-category template: the code is sent as the body');
  console.log('  parameter {{1}} AND as the copy-code button parameter at index 0.');

  // Send is gated on this outcome: firing at Meta with an unapproved or
  // mis-shaped template just burns the customer's 30s resend cooldown and
  // proves nothing. Nothing is sent until the template is confirmed usable.
  const checks = {};
  let templateReady = false;
  let templateDetail = 'template inventory unavailable (WHATSAPP_BUSINESS_ACCOUNT_ID not set)';

  /** Look one template up and assert status / category / language. */
  function checkTemplate(list, name, expectedCategory, wantLanguage) {
    const match = list.find((t) => t.name === name);
    if (!match) {
      line(false, `Template "${name}" exists`, 'no template with that exact name');
      return {
        ok: false,
        detail:
          `No template named "${name}". Templates on this account: ` +
          (list.length ? list.map((t) => `"${t.name}" (${t.status})`).join(', ') : 'none listed'),
      };
    }

    const approved = match.status === 'APPROVED';
    const category = String(match.category || '').toUpperCase();
    const language = String(match.language || '');

    const problems = [];
    if (!approved) problems.push(`status is ${match.status}, not APPROVED`);
    if (expectedCategory && category !== expectedCategory) {
      problems.push(`category is "${category}", the code sends ${expectedCategory}`);
    }
    if (wantLanguage && language !== wantLanguage) {
      problems.push(`language is "${language}", the code sends "${wantLanguage}"`);
    }

    // Keep the "is APPROVED" wording: preflight.js greps for it.
    if (approved) {
      line(true, `Template "${name}" is APPROVED`,
        `status=${match.status} lang=${match.language} category=${match.category || '?'} params=${match.parameter_count ?? '?'}`);
    } else {
      line(false, `Template "${name}" is APPROVED`, `status=${match.status}`);
    }

    if (problems.length) {
      const detail = `Template "${name}" is not usable: ${problems.join('; ')}`;
      console.log(`        BLOCKING: ${detail}`);
      return { ok: false, detail };
    }
    return {
      ok: true,
      detail: `${name} approved, ${language}, ${category || 'category n/a'}`,
    };
  }

  if (!wabaId) {
    line(false, 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'not set — cannot verify the template, so --send is blocked');
    checks.otpTemplate = { ok: false, detail: 'WHATSAPP_BUSINESS_ACCOUNT_ID not set' };
    checks.waba = { ok: false, detail: 'not set' };
  } else {
    checks.waba = { ok: true, id: String(wabaId) };
    const tpl = await api(`/${wabaId}/message_templates?fields=name,status,language,category,parameter_count`);
    const list = tpl.json?.data || [];

    if (!OTP_TEMPLATE) {
      line(false, 'WHATSAPP_OTP_TEMPLATE_NAME', 'not set — the app would guess a template name');
      checks.otpTemplate = {
        ok: false,
        detail: 'WHATSAPP_OTP_TEMPLATE_NAME is not set',
      };
      templateDetail = checks.otpTemplate.detail;
    } else if (!TEMPLATE_LANG) {
      line(false, 'WHATSAPP_TEMPLATE_LANG', 'not set — the language must match the approved template exactly');
      checks.otpTemplate = {
        ok: false,
        detail: 'WHATSAPP_TEMPLATE_LANG is not set',
      };
      templateDetail = checks.otpTemplate.detail;
    } else {
      const outcome = checkTemplate(list, OTP_TEMPLATE, 'AUTHENTICATION', TEMPLATE_LANG);
      checks.otpTemplate = outcome;
      templateReady = outcome.ok;
      templateDetail = outcome.detail;
    }

    // The invoice template only matters when the flag is on.
    if (INVOICE_ENABLED) {
      if (!INVOICE_TEMPLATE) {
        line(false, 'WHATSAPP_INVOICE_TEMPLATE_NAME',
          'not set while WHATSAPP_INVOICE_ENABLED=true');
        checks.invoiceTemplate = {
          ok: false,
          detail: 'WHATSAPP_INVOICE_ENABLED=true but WHATSAPP_INVOICE_TEMPLATE_NAME is not set',
        };
      } else {
        // Invoices are UTILITY templates, not AUTHENTICATION ones.
        checks.invoiceTemplate = checkTemplate(list, INVOICE_TEMPLATE, 'UTILITY', TEMPLATE_LANG);
      }
    }
  }

  checks.token = { ok: Boolean(tokenOk) };
  checks.phoneId = { ok: Boolean(phoneOk) };

  // ---- 6. Optional real send ---------------------------------------------
  if (send) {
    if (!phoneOk) {
      console.log('\n  NOT SENDING. The Phone Number ID cannot be loaded by this token, so any');
      console.log('  send attempt would fail with Graph error 100. Fix the id or the System');
      console.log('  User\'s WABA assignment first - see the steps above.');
      process.exitCode = 1;
    } else if (!templateReady) {
      console.log('\n  NOT SENDING. --send requires a confirmed, APPROVED template first.');
      console.log(`  Reason: ${templateDetail}`);
      console.log('  Set WHATSAPP_BUSINESS_ACCOUNT_ID, fix the template in Meta Business Manager,');
      console.log('  then re-run. Nothing was sent and no cooldown was consumed.');
      process.exitCode = 1;
    } else if (!testRecipient) {
      line(false, 'ADMIN_WHATSAPP_NUMBER', 'not set - refusing to guess a recipient');
      process.exitCode = 1;
    } else {
      // Build exactly what the app builds: an AUTHENTICATION-category payload
      // with the code as the body parameter AND as the copy-code button
      // parameter at index 0. A body-only payload is what Meta rejects.
      const TEST_CODE = '123456';
      const res = await api(`/${phoneId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: testRecipient,
          type: 'template',
          template: {
            name: OTP_TEMPLATE,
            language: { code: TEMPLATE_LANG },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: TEST_CODE }] },
              {
                type: 'button',
                sub_type: 'copy_code',
                index: '0',
                parameters: [{ type: 'text', text: TEST_CODE }],
              },
            ],
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

  // ---- 7. Machine-readable result + exit code -----------------------------
  // go-live.js reads this line instead of scraping prose. It contains check
  // NAMES and booleans only — no token, no phone number, no secret value.
  const allOk =
    Boolean(checks.token?.ok) &&
    Boolean(checks.waba?.ok) &&
    Boolean(checks.phoneId?.ok) &&
    Boolean(checks.otpTemplate?.ok) &&
    (checks.invoiceTemplate ? Boolean(checks.invoiceTemplate.ok) : true);

  console.log(
    `GO_LIVE_JSON ${JSON.stringify({
      token: Boolean(checks.token?.ok),
      waba: Boolean(checks.waba?.ok),
      phoneId: Boolean(checks.phoneId?.ok),
      otpTemplate: Boolean(checks.otpTemplate?.ok),
      otpTemplateCategory: 'AUTHENTICATION',
      otpTemplateLanguage: TEMPLATE_LANG || null,
      otpTemplateName: OTP_TEMPLATE || null,
      invoiceTemplate: checks.invoiceTemplate ? Boolean(checks.invoiceTemplate.ok) : null,
      invoiceTemplateName: INVOICE_ENABLED ? INVOICE_TEMPLATE || null : null,
      allOk,
    })}`
  );

  // Nothing here printed a secret, so this is safe to log.
  process.exit(allOk && !process.exitCode ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});