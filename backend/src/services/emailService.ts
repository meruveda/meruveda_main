import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'MeruVeda <no-reply@meruvedawellness.com>';

if (!resendApiKey) {
  console.warn(
    `\n[EmailService] ⚠️ WARNING: Missing required Resend environment variables! ` +
    `Ensure RESEND_API_KEY is configured in your .env file.\n`
  );
}

let resend: Resend | null = null;
if (resendApiKey) {
  try {
    resend = new Resend(resendApiKey);
  } catch (error) {
    console.error('[EmailService] Failed to initialize Resend client:', error);
  }
}

export const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  return sendEmailWithAttachments({ to, subject, html });
};

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

/**
 * Send an HTML email with optional attachments (used for the PDF invoice).
 * Returns true only when the provider accepted the message.
 */
export const sendEmailWithAttachments = async (options: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
}): Promise<boolean> => {
  const { to, subject, html, attachments, headers } = options;
  try {
    if (!resend) {
      console.warn('[EmailService] Resend is not configured. Email cannot be sent.');
      return false;
    }

    const response = await resend.emails.send(
      {
        from: emailFrom,
        to,
        subject,
        html,
        ...(attachments && attachments.length
          ? {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
        ...(headers ? { headers } : {}),
      }
    );

    if (response.error) {
      console.error('[EmailService] Provider rejected the message:', response.error);
      return false;
    }

    console.log(`[EmailService] Email sent successfully: ${response.data?.id}`);
    return true;
  } catch (error) {
    console.error('[EmailService] Error sending email:', error);
    return false;
  }
};

/** True when a Resend API key is present and the client initialised. */
export const isEmailConfigured = (): boolean => Boolean(resend);

/**
 * Short, plain invoice email body. The PDF is attached; a 7-day signed link is
 * included when the invoice PDF was mirrored to Supabase Storage.
 */
export const getInvoiceEmailTemplate = (options: {
  firstName?: string;
  orderNumber: string;
  invoiceNumber: string;
  total: string;
  signedUrl?: string | null;
}): string => {
  const { firstName, orderNumber, invoiceNumber, total, signedUrl } = options;
  const greeting = firstName ? `Namaste ${firstName}` : 'Namaste';
  const linkBlock = signedUrl
    ? `<p style="margin:0 0 10px 0;font-size:14px;color:#4A3E3D;">You can also open it here (link valid for 7 days):<br>
         <a href="${signedUrl}" style="word-break:break-all;color:#C09E5A;">${signedUrl}</a></p>`
    : '';
  return `
    <!DOCTYPE html><html><body style="margin:0;padding:0;background:#F9F6F0;font-family:Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9F6F0;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #EFEAE2;">
            <tr><td style="background:#2B1820;padding:22px 24px;">
              <div style="color:#C09E5A;font-size:22px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">MeruVeda</div>
              <div style="color:#E2D3C1;font-size:11px;letter-spacing:1px;text-transform:uppercase;">Tax invoice attached</div>
            </td></tr>
            <tr><td style="padding:24px;">
              <p style="margin:0 0 14px 0;font-size:16px;color:#2B1820;">${greeting},</p>
              <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#4A3E3D;">
                Thank you for your order. Your tax invoice <strong>${invoiceNumber}</strong>
                for order <strong>#${orderNumber}</strong> (${total}) is attached as a PDF.
              </p>
              ${linkBlock}
              <p style="margin:16px 0 0 0;font-size:13px;color:#8A7E7D;">
                Keep this invoice for your records. Questions? Reply to this email or contact
                customercare@meruvedawellness.com.
              </p>
            </td></tr>
            <tr><td style="background:#F9F6F0;padding:14px 24px;font-size:12px;color:#8A7E7D;">
              This is an automated message — please do not reply to this notification.
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
};


export const getPasswordResetTemplate = (resetLink: string, firstName: string = 'Valued Customer'): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="x-ua-compatible" content="ie=edge">
      <title>Password Reset Request</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style type="text/css">
        body, table, td, a { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; }
        body { width: 100% !important; height: 100% !important; padding: 0 !important; margin: 0 !important; background-color: #F9F6F0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #4A3E3D; }
        a { color: #C09E5A; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body style="background-color: #F9F6F0;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding: 40px 10px 20px 10px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" max-width="600" style="max-width: 600px; background-color: #2B1820; border-radius: 16px 16px 0 0; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
              <tr>
                <td align="center" valign="top" style="padding: 30px 20px;">
                  <h1 style="color: #C09E5A; margin: 0; font-family: Georgia, serif; font-size: 28px; letter-spacing: 2px; text-transform: uppercase;">MERUVEDA</h1>
                  <p style="color: #E2D3C1; margin: 5px 0 0 0; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">Authentic Ayurvedic Wellness</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 0 10px 40px 10px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" max-width="600" style="max-width: 600px; background-color: #FFFFFF; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #EFEAE2; border-top: none;">
              <tr>
                <td align="left" style="padding: 40px 30px; font-size: 16px; line-height: 1.6;">
                  <p style="margin: 0 0 20px 0; font-size: 18px; font-weight: bold; color: #2B1820;">Namaste ${firstName},</p>
                  <p style="margin: 0 0 20px 0;">We received a request to reset the password for your MeruVeda account. Click the button below to choose a new secure password:</p>
                  
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 30px 0;">
                    <tr>
                      <td align="center">
                        <table border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center" bgcolor="#2B1820" style="border-radius: 8px;">
                              <a href="${resetLink}" target="_blank" style="display: inline-block; padding: 14px 30px; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; color: #C09E5A; text-decoration: none; border-radius: 8px; border: 1px solid #C09E5A;">Reset Password</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  
                  <p style="margin: 0 0 15px 0;">This reset link will expire in <strong>1 hour</strong>. If you did not request a password reset, please ignore this email or contact our support team if you have concerns.</p>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #8A7E7D;">If the button above does not work, copy and paste this link into your browser:<br>
                  <a href="${resetLink}" style="word-break: break-all;">${resetLink}</a></p>
                  
                  <hr style="border: none; border-top: 1px solid #EFEAE2; margin: 30px 0;">
                  
                  <p style="margin: 0; font-size: 14px; color: #8A7E7D;">In health and wellness,<br><strong style="color: #2B1820;">The MeruVeda Team</strong></p>
                </td>
              </tr>
              <tr bgcolor="#F9F6F0">
                <td align="center" style="padding: 20px 30px; font-size: 12px; color: #8A7E7D; border-radius: 0 0 16px 16px; border-top: 1px solid #EFEAE2;">
                  <p style="margin: 0 0 10px 0;">This is an automated message, please do not reply directly to this email.</p>
                  <p style="margin: 0;">© 2026 MeruVeda Wellness. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};
