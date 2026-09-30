import nodemailer from 'nodemailer';
import { getRedisClient } from '../config/redis';

export interface EtherealCredentials {
  user: string;
  pass: string;
  smtpHost: string;
  smtpPort: number;
}

export async function createEtherealAccount(): Promise<EtherealCredentials> {
  const testAccount = await nodemailer.createTestAccount();
  return {
    user: testAccount.user,
    pass: testAccount.pass,
    smtpHost: testAccount.smtp.host,
    smtpPort: testAccount.smtp.port,
  };
}

export async function sendEmailViaEthereal(params: {
  smtpUser: string;
  smtpPass: string;
  smtpHost?: string;
  smtpPort?: number;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  messageId?: string;
}): Promise<{ messageId: string; previewUrl: string | false }> {
  if ((process.env.SMTP_MODE || 'ethereal').toLowerCase() === 'stub') {
    const latencyMs = Math.max(0, Number.parseInt(process.env.SMTP_STUB_LATENCY_MS || '0', 10));
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const messageId = params.messageId || `<reachinbox-stub-${Date.now()}@reachinbox.local>`;
    await getRedisClient().set(`smtp:stub:accepted:${messageId}`, '1', 'EX', 86400, 'NX');
    return {
      messageId,
      previewUrl: false,
    };
  }

  const transporter = nodemailer.createTransport({
    host: params.smtpHost || 'smtp.ethereal.email',
    port: params.smtpPort || 587,
    secure: false,
    auth: {
      user: params.smtpUser,
      pass: params.smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from: `"${params.fromName}" <${params.fromEmail}>`,
    to: params.toEmail,
    subject: params.subject,
    text: params.body,
    messageId: params.messageId,
    html: `<div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
      <h2 style="color: #4F46E5;">${params.subject}</h2>
      <p style="white-space: pre-wrap;">${params.body}</p>
      <hr style="border: 0; border-top: 1px solid #E5E7EB; margin-top: 20px;" />
      <p style="font-size: 12px; color: #6B7280;">Sent securely via ReachInbox Scheduler Service</p>
    </div>`,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log(`✉️ Email dispatched to ${params.toEmail} | Message ID: ${info.messageId} | Preview: ${previewUrl}`);

  return {
    messageId: info.messageId,
    previewUrl: previewUrl || false,
  };
}
