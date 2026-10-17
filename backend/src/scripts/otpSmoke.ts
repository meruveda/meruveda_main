/**
 * Real OTP smoke test against the actual WhatsApp path.
 *
 * Sends a genuine OTP through the same service the checkout uses, waits for the
 * code to be typed in, then verifies it. Prints PASS/FAIL.
 *
 * This is the only script in the repo that proves the whole chain works, so it
 * refuses to run unless the preconditions genuinely hold — a DRY_RUN or missing
 * token would "pass" while sending nothing, which is exactly the false green
 * this script exists to eliminate.
 *
 * The code is never logged or printed by this script, and no OTP is stored
 * anywhere outside the otps table.
 *
 * Usage:
 *   npm run otp:smoke -- +919876543210
 */
import readline from 'node:readline';
import { otpService } from '../services/otpService';
import { normalizePhone, isWhatsappConfigured } from '../services/whatsappService';
import { config } from '../config/env';

function bail(msg: string): never {
  console.error('\nREFUSING TO RUN: ' + msg + '\n');
  process.exit(1);
}

const WHY: Record<string, string> = {
  not_found: 'no active OTP for that number (expired, already used, or never arrived)',
  expired: 'the code had expired',
  already_used: 'the code had already been used — codes are single-use',
  too_many_attempts: 'the 5-attempt limit was reached',
  invalid: 'the code did not match',
};

async function main() {
  const raw = process.argv[2];
  if (!raw) bail('no number given. Usage: npm run otp:smoke -- +919876543210');

  const phone = normalizePhone(raw);
  if (!phone || phone.length < 12) bail('"' + raw + '" is not a usable mobile number');

  if (config.whatsappDryRun) {
    bail('WHATSAPP_DRY_RUN=true — this would report success without sending anything.');
  }
  if (!isWhatsappConfigured()) {
    bail('WhatsApp is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing or placeholders).');
  }
  if (!config.otpHashPepper) {
    bail('OTP_HASH_SECRET is unset — codes would be hashed with the development fallback.');
  }

  console.log('OTP smoke test');
  console.log('  target   : ' + phone);
  console.log('  template : ' + (process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'otp_verification (default)'));
  console.log('  lang     : ' + config.whatsappTemplateLang);
  console.log('\nRequesting an OTP...\n');

  let sent;
  try {
    sent = await otpService.sendOtp(phone);
  } catch (e: any) {
    console.error('\nFAIL — the send was rejected: ' + e.message);
    console.error('A rejected send is never reported as success.');
    process.exit(1);
  }

  console.log('Accepted by the sender. Code expires in ' + sent.expiresInSeconds + 's.');

  if (sent.devOtp) {
    console.log('(dev server: the code is ' + sent.devOtp + ' — it is still dispatched to WhatsApp)');
  }
  console.log('\nCheck WhatsApp on the target number and enter the code below.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise<string>((resolve) => rl.question('  code: ', resolve));
  rl.close();

  const submitted = String(code || '').replace(/\D/g, '');
  const result = await otpService.verifyOtp(phone, submitted);

  console.log('');
  if (result.ok) {
    console.log('PASS — the code was accepted and the OTP was consumed.');
    process.exit(0);
  }

  console.log('FAIL — ' + (WHY[result.reason] || result.reason) + '.');
  process.exit(1);
}

main().catch((e) => {
  console.error('Unexpected: ' + (e?.message || e));
  process.exit(1);
});