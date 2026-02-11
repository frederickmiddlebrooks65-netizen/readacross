import crypto from 'crypto';
import { Resend } from 'resend';

const DEFAULT_FROM_EMAIL = 'ReadAcross <no-reply@mail.readacross.io>';

function getResendClient(): { client: Resend; fromEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  
  if (!apiKey) {
    console.warn('[EMAIL] RESEND_API_KEY not found in environment variables');
    return null;
  }
  
  return {
    client: new Resend(apiKey),
    fromEmail: DEFAULT_FROM_EMAIL
  };
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<boolean> {
  const resendClient = getResendClient();
  
  if (!resendClient) {
    console.log('\n=== EMAIL (Development Mode - No RESEND_API_KEY configured) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('HTML:', html.substring(0, 200) + '...');
    console.log('=================================================================\n');
    return false;
  }

  try {
    console.log('[EMAIL] Sending email from:', resendClient.fromEmail, 'to:', to);
    
    const { data, error } = await resendClient.client.emails.send({
      from: resendClient.fromEmail,
      to: [to],
      subject,
      html,
      text: text || undefined,
    });

    if (error) {
      console.error('[EMAIL] Failed to send email:', error);
      return false;
    }

    console.log('[EMAIL] Email sent successfully:', data?.id);
    return true;
  } catch (error) {
    console.error('[EMAIL] Error sending email:', error);
    return false;
  }
}

export function generateVerificationEmailHtml(username: string, verificationUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - ReadAcross</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #1a1a1a;">ReadAcross</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">Verify Your Email Address</h2>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a5568;">Hi ${username},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a5568;">
                Thank you for signing up for ReadAcross! To complete your registration and start using your account, please verify your email address by clicking the button below.
              </p>
              <table role="presentation" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${verificationUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 20px; color: #718096;">
                Or copy and paste this link into your browser:<br>
                <a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 20px; color: #718096;">
                This verification link will expire in 24 hours.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #718096;">
                If you didn't create an account with ReadAcross, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                © ${new Date().getFullYear()} ReadAcross. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function generatePasswordResetEmailHtml(username: string, resetUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - ReadAcross</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #1a1a1a;">ReadAcross</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">Reset Your Password</h2>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a5568;">Hi ${username},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a5568;">
                We received a request to reset your password for your ReadAcross account. Click the button below to choose a new password.
              </p>
              <table role="presentation" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 20px; color: #718096;">
                Or copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #dc2626; word-break: break-all;">${resetUrl}</a>
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 20px; color: #718096;">
                This password reset link will expire in 1 hour.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #718096;">
                If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                © ${new Date().getFullYear()} ReadAcross. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function generateVerificationEmailText(username: string, verificationUrl: string): string {
  return `
Hi ${username},

Thank you for signing up for ReadAcross!

To complete your registration and start using your account, please verify your email address by visiting this link:

${verificationUrl}

This verification link will expire in 24 hours.

If you didn't create an account with ReadAcross, you can safely ignore this email.

© ${new Date().getFullYear()} ReadAcross. All rights reserved.
  `.trim();
}

export function generatePasswordResetEmailText(username: string, resetUrl: string): string {
  return `
Hi ${username},

We received a request to reset your password for your ReadAcross account.

To reset your password, visit this link:

${resetUrl}

This password reset link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

© ${new Date().getFullYear()} ReadAcross. All rights reserved.
  `.trim();
}
