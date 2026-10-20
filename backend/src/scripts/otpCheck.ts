/**
 * `npm run otp:check`
 *
 * Prints the WhatsApp message templates Meta currently knows about, their
 * status, and which one the OTP and invoice paths would use right now.
 *
 * Read-only: it never sends a message and never creates a template. To create
 * the OTP template, run `npm run otp:check -- --create-otp`; for the invoice
 * template, `--create-invoice`.
 */
import 'dotenv/config';
import {
  listTemplates,
  resolveOtpTemplate,
  resolveInvoiceTemplate,
  otpAvailability,
  ensureOtpTemplate,
  ensureInvoiceTemplate,
  templateResolverConfigured,
  invalidateTemplateCache,
} from '../services/whatsappTemplateResolver';

function line(s = ''): void {
  console.log(s);
}

/**
 * Exit without calling process.exit().
 *
 * process.exit() while undici still holds an open socket trips a libuv
 * assertion on Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)")
 * and turns a successful run into a non-zero exit code. Setting exitCode and
 * letting the event loop drain gives the same status without the crash.
 */
function finish(code: number): void {
  process.exitCode = code;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (!templateResolverConfigured()) {
    line('WhatsApp template resolver is NOT configured.');
    line('  Required: WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID');
    finish(2);
  }

  if (args.includes('--create-otp')) {
    const result = await ensureOtpTemplate();
    line(result.created ? `Created OTP template "${result.name}" (awaiting Meta approval).` : `OTP template not created: ${result.reason}`);
    invalidateTemplateCache();
  }
  if (args.includes('--create-invoice')) {
    const result = await ensureInvoiceTemplate();
    line(result.created ? `Created invoice template "${result.name}" (awaiting Meta approval).` : `Invoice template not created: ${result.reason}`);
    invalidateTemplateCache();
  }

  const { templates, error, permissionDenied } = await listTemplates({ force: true });

  if (error) {
    line('Could not read templates from Meta.');
    line(`  ${error}`);
    if (permissionDenied) {
      line('  This looks like a permissions problem: the token needs the');
      line('  whatsapp_business_management permission for template management.');
    }
    finish(3);
  }

  line(`WhatsApp templates (${templates.length}):`);
  line('');
  if (templates.length === 0) {
    line('  (none -- the WABA has no message templates yet)');
  }
  for (const t of templates) {
    const doc = (t.components || []).some((c) => c.type === 'HEADER' && String(c.format).toUpperCase() === 'DOCUMENT');
    const otpBtn = (t.components || []).some((c) => (c.buttons || []).some((b) => String(b.type).toUpperCase() === 'OTP'));
    const flags = [doc ? 'document-header' : '', otpBtn ? 'otp-button' : ''].filter(Boolean).join(',');
    line(`  ${t.name}  [${t.status}]  ${t.language}  ${t.category || 'unknown'}${flags ? `  (${flags})` : ''}`);
  }
  line('');

  const otp = resolveOtpTemplate(templates);
  const inv = resolveInvoiceTemplate(templates);
  const availability = await otpAvailability();

  line('Resolved now:');
  line(
    `  OTP template     : ${otp ? `${otp.name} (lang ${otp.language}, via ${otp.source})` : 'NONE AVAILABLE'}`,
  );
  line(
    `  Invoice template : ${inv ? `${inv.name} (lang ${inv.language}, via ${inv.source})` : 'NONE AVAILABLE'}`,
  );
  line(
    `  OTP mode         : ${availability.mode} -> verification ${availability.required ? 'REQUIRED' : 'not required'}`,
  );
  if (availability.reason) line(`  Reason           : ${availability.reason}`);

  const otpUsable = Boolean(otp);
  const invUsable = Boolean(inv);
  line('');
  line(otpUsable
    ? '  OTP delivery is LIVE -- the checkout requires phone verification.'
    : '  OTP delivery is NOT live yet. It auto-activates the moment an AUTHENTICATION template is approved.');
  line(invUsable
    ? '  Invoice WhatsApp sending is LIVE.'
    : '  Invoice WhatsApp sending is not live yet -- invoices are still generated and downloadable, just not sent.');

  finish(0);
}

main().catch((err) => {
  console.error('otp:check failed:', err?.message || err);
  finish(1);
});
