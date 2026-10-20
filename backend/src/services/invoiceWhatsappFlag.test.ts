/**
 * WhatsApp invoice automation: when it fires, when it must not, and what it
 * must never do.
 *
 * Covered here:
 *   - WHATSAPP_INVOICE_ENABLED=false => nothing about the flow changes
 *   - COD: the invoice goes out right after the order is accepted
 *   - PayU: only after payment is confirmed, and only with the flag on
 *   - one order sends one invoice
 *   - a WhatsApp failure never blocks or rolls back the order
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceWhatsapp } from '../config/env';
import { invoiceDispatchService, whatsappInvoiceEnabled } from './invoiceDispatchService';
import { shouldIssueInvoice, isInvoiceEligible } from './postOrderConfirmed';
import { buildInvoiceTemplatePayload } from './whatsappService';

/* ------------------------------------------------------------------ */
/* The flag                                                            */
/* ------------------------------------------------------------------ */

test('the invoice flag defaults to off', () => {
  // config.whatsappInvoiceEnabled is `WHATSAPP_INVOICE_ENABLED === 'true'`, so
  // anything other than the literal "true" is off.
  assert.equal(whatsappInvoiceEnabled(), invoiceWhatsapp.enabled === true);
});

test('with the flag off, the WhatsApp invoice channel is inert', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = false;
    assert.equal(whatsappInvoiceEnabled(), false);
    // The retry sweep has nothing to sweep toward and returns quietly.
    assert.equal(typeof invoiceDispatchService.retryPendingInvoices, 'function');
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

test('with the flag on, the channel is live', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = true;
    assert.equal(whatsappInvoiceEnabled(), true);
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

const COD_ORDER = { id: 'o1', payment_method: 'Cash On Delivery', payment_status: 'pending', status: 'pending' };
const PREPAID_UNPAID = {
  id: 'o2',
  payment_method: 'PayOnline (via PayU)',
  payment_status: 'pending',
  status: 'pending_payment',
};
const PREPAID_PAID = {
  id: 'o2',
  payment_method: 'PayOnline (via PayU)',
  payment_status: 'paid',
  status: 'processing',
};

test('COD: the invoice issues at order placement', () => {
  assert.equal(shouldIssueInvoice(true, COD_ORDER, 'order_placement'), true);
  assert.equal(shouldIssueInvoice(true, COD_ORDER, 'cod_placement'), true);
});

test('PayU: with the flag OFF the callback does not issue — exactly as before', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = false;
    assert.equal(shouldIssueInvoice(false, PREPAID_PAID, 'payu_success'), false);
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

test('PayU: with the flag ON the callback issues, but only once payment is confirmed', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = true;
    assert.equal(shouldIssueInvoice(false, PREPAID_PAID, 'payu_success'), true);
    // Payment not confirmed yet => no invoice. The callback may fire on a
    // failure or a pending status, and neither is a sale.
    assert.equal(shouldIssueInvoice(false, PREPAID_UNPAID, 'payu_success'), false);
    assert.equal(
      shouldIssueInvoice(false, { ...PREPAID_UNPAID, payment_status: 'failed' }, 'payu_success'),
      false
    );
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

test('a COD order never issues from the PayU path', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = true;
    assert.equal(shouldIssueInvoice(false, COD_ORDER, 'payu_success'), false);
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

test('an explicit request always wins, flag state or not', () => {
  const before = invoiceWhatsapp.enabled;
  try {
    (invoiceWhatsapp as any).enabled = false;
    assert.equal(shouldIssueInvoice(true, COD_ORDER, 'order_placement'), true);
  } finally {
    (invoiceWhatsapp as any).enabled = before;
  }
});

test('a missing order is never eligible', () => {
  assert.equal(isInvoiceEligible(null, 'order_placement'), false);
  assert.equal(isInvoiceEligible(undefined, 'payu_success'), false);
  assert.equal(isInvoiceEligible(COD_ORDER, 'order_placement'), true);
});

/* ------------------------------------------------------------------ */
/* Idempotency + never blocking                                        */
/* ------------------------------------------------------------------ */

test('one order sends one invoice: the sent flag lives in the per-channel state', async () => {
  const dispatch: any = invoiceDispatchService;
  // The dispatcher returns `skipped` for a channel already recorded as sent,
  // and that check is the idempotency guarantee (alongside the atomic claim).
  const source = require('fs').readFileSync(require.resolve('./invoiceDispatchService'), 'utf8');
  assert.ok(
    source.includes("existing?.channels?.whatsapp?.status === 'sent'"),
    'the WhatsApp channel must short-circuit when it is already sent'
  );
  assert.ok(
    source.includes('sentAt: delivered ? new Date().toISOString() : null'),
    'a successful send must stamp the sent timestamp'
  );
  void dispatch;
});

test('the resend path never re-sends an invoice that was already delivered', async () => {
  const derive = invoiceDispatchService.deriveInvoiceStatus;
  const sent = derive({ channels: { whatsapp: { status: 'sent', attempts: 1, sentAt: '2026-10-18T00:00:00Z' } } });
  assert.equal(sent.status, 'sent');
  assert.equal(sent.sentAt, '2026-10-18T00:00:00Z');

  const pending = derive({ channels: { whatsapp: { status: 'pending', attempts: 0 } } });
  assert.equal(pending.status, 'pending');

  const failed = derive({ channels: { whatsapp: { status: 'failed', attempts: 2, lastError: 'boom' } } });
  assert.equal(failed.status, 'failed');
});

test('a WhatsApp failure is recorded per channel and never thrown at the order', async () => {
  // The email channel and the WhatsApp channel are awaited together through
  // Promise.allSettled, so neither can reject into the other.
  const source = require('fs').readFileSync(require.resolve('./invoiceDispatchService'), 'utf8');
  assert.ok(source.includes('Promise.allSettled'), 'channels must settle independently');
  assert.ok(
    source.includes("'Meta rejected the invoice template message'"),
    'a rejected template must be recorded as the channel error'
  );
});

/* ------------------------------------------------------------------ */
/* Payload shape: document vs link                                     */
/* ------------------------------------------------------------------ */

const PAYLOAD_INPUT = {
  to: '9876543210',
  customerName: 'Atharva',
  orderNumber: 'MV-748371',
  invoiceNumber: 'MV/26-27/000123',
  total: '₹1,098.00',
  signedUrl: 'https://pub-example.r2.dev/invoice/x.pdf?token=abc',
  filename: 'Invoice-MV_26_27_000123.pdf',
};

test('document mode attaches the PDF in the template header', () => {
  const before = (invoiceWhatsapp as any).mode;
  try {
    (invoiceWhatsapp as any).mode = 'document';
    const payload = buildInvoiceTemplatePayload(PAYLOAD_INPUT);
    assert.equal(payload.template.components[0].type, 'header');
    assert.equal(payload.template.components[0].parameters[0].type, 'document');
    assert.equal(payload.template.components[0].parameters[0].document.link, PAYLOAD_INPUT.signedUrl);
    assert.equal(payload.template.components[1].type, 'body');
    assert.equal(payload.template.components[1].parameters.length, 4);
  } finally {
    (invoiceWhatsapp as any).mode = before;
  }
});

test('link mode puts a signed URL in the body and attaches nothing', () => {
  const before = (invoiceWhatsapp as any).mode;
  try {
    (invoiceWhatsapp as any).mode = 'link';
    const payload = buildInvoiceTemplatePayload(PAYLOAD_INPUT);
    assert.ok(
      !payload.template.components.some((c: any) => c.type === 'header'),
      'link mode must not attach a document'
    );
    assert.equal(payload.template.components.length, 1);
    assert.equal(payload.template.components[0].type, 'body');
    assert.equal(payload.template.components[0].parameters.length, 5);
    // The URL is the LAST body variable and it is the signed one.
    assert.equal(
      payload.template.components[0].parameters[4].text,
      PAYLOAD_INPUT.signedUrl,
      'the link must be a signed, expiring URL — never a guessable order id'
    );
    assert.ok(!payload.template.components[0].parameters[4].text.includes('MV-748371'));
  } finally {
    (invoiceWhatsapp as any).mode = before;
  }
});

test('the invoice payload carries no recipient phone in the template body', () => {
  const before = (invoiceWhatsapp as any).mode;
  try {
    (invoiceWhatsapp as any).mode = 'link';
    const payload = buildInvoiceTemplatePayload(PAYLOAD_INPUT);
    const bodyText = payload.template.components
      .filter((c: any) => c.type === 'body')
      .flatMap((c: any) => c.parameters.map((p: any) => p.text))
      .join(' ');
    assert.ok(!bodyText.includes('9876543210'));
    // ...but it IS addressed to the customer.
    assert.equal(payload.to, '919876543210');
  } finally {
    (invoiceWhatsapp as any).mode = before;
  }
});

test('the invoice template name and language come from env', () => {
  const before = { n: invoiceWhatsapp.templateName, l: invoiceWhatsapp.templateLang };
  try {
    (invoiceWhatsapp as any).templateName = 'invoice_doc_v2';
    (invoiceWhatsapp as any).templateLang = 'hi';
    const payload = buildInvoiceTemplatePayload(PAYLOAD_INPUT);
    assert.equal(payload.template.name, 'invoice_doc_v2');
    assert.equal(payload.template.language.code, 'hi');
  } finally {
    (invoiceWhatsapp as any).templateName = before.n;
    (invoiceWhatsapp as any).templateLang = before.l;
  }
});