import { DelayedError, Worker, Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redisConfig } from '../config/redis';
import { QUEUE_NAME, EmailJobData } from './email.queue';
import { prisma } from '../config/prisma';
import { sendEmailViaEthereal } from '../services/ethereal.service';
import { acquireSenderSendLock, checkAndIncrementRateLimit, getHourWindowStartMs, releaseSenderSendLock } from '../services/rate-limiter.service';
import { sendSlackRateLimitAlert } from '../services/slack.service';
import { indexEmailDoc } from '../services/elasticsearch.service';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3', 10);
const SENDING_RECOVERY_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.SENDING_RECOVERY_TIMEOUT_MS || '30000', 10));

export function initEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      await processSingleEmail(job.data, job);
    },
    {
      connection: redisConfig,
      concurrency: WORKER_CONCURRENCY,
      lockDuration: Number.parseInt(process.env.BULLMQ_LOCK_DURATION_MS || '30000', 10),
      lockRenewTime: Number.parseInt(process.env.BULLMQ_LOCK_RENEW_TIME_MS || '15000', 10),
      stalledInterval: Number.parseInt(process.env.BULLMQ_STALLED_INTERVAL_MS || '1000', 10),
      maxStalledCount: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ BullMQ Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ BullMQ Job ${job?.id} failed:`, err.message);
  });

  console.log(`⚡ BullMQ Worker listening with concurrency level: ${WORKER_CONCURRENCY}`);
  return worker;
}

export async function processSingleEmail(data: EmailJobData, job?: Job<EmailJobData>) {
  const { emailId, senderId, delayBetweenSec } = data;

  // 1. Fetch latest DB state
  let email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true, user: true }
  });

  if (!email) {
    console.warn(`⚠️ Email record ${emailId} not found in DB. Skipping.`);
    return;
  }

  if (email.status === 'SENDING') {
    if (email.messageId) {
      const recovered = await prisma.email.update({
        where: { id: emailId },
        data: { status: 'SENT', sentAt: email.sentAt || email.sendingStartedAt || new Date() },
        include: { sender: true },
      });
      await indexEmailDoc(recovered);
      console.info(`✅ Job ${job?.id} recovered ${emailId} as sent using ${email.messageId}.`);
      return;
    }
    const recoverAt = (email.sendingStartedAt?.getTime() || Date.now()) + SENDING_RECOVERY_TIMEOUT_MS;
    if (recoverAt > Date.now() && job?.token) {
      await job.moveToDelayed(recoverAt, job.token);
      throw new DelayedError();
    }
    email = await prisma.email.update({
      where: { id: emailId },
      data: { status: 'SCHEDULED', sendingStartedAt: null },
      include: { sender: true, user: true },
    });
  }

  if (email.status === 'SENT') {
    console.log(`ℹ️ Email ${emailId} already marked SENT. Idempotency enforced.`);
    return;
  }

  if (email.status !== 'SCHEDULED') {
    console.log(`ℹ️ Email ${emailId} is already claimed or no longer sendable.`);
    return;
  }

  const sender = email.sender;
  if (!sender) {
    console.error(`❌ Sender not found for email ${emailId}`);
    return;
  }

  // 2. Rate Limit Verification
  const currentWindowStartMs = getHourWindowStartMs();
  const persistedReservation = email.rateLimitReservedWindowStartMs === null
    ? undefined
    : Number(email.rateLimitReservedWindowStartMs);
  const hasCurrentSlotReservation = (data.slotReservedWindowStartMs ?? persistedReservation) === currentWindowStartMs;
  const rateLimitResult = hasCurrentSlotReservation
    ? null
    : await checkAndIncrementRateLimit({
        senderId: sender.id,
        hourlyLimit: data.hourlyLimit || email.hourlyLimit || sender.hourlyLimit,
        minimumDelayMs: data.minimumDelayMs ?? email.delayBetweenMs ?? Math.max(0, delayBetweenSec || 0) * 1000,
      });

  if (rateLimitResult?.allowed) {
    data.slotReservedWindowStartMs = rateLimitResult.hourWindowStartMs;
    await prisma.email.update({
      where: { id: emailId },
      data: { rateLimitReservedWindowStartMs: BigInt(rateLimitResult.hourWindowStartMs) },
    });
    await job?.updateData(data);
  }

  if (rateLimitResult && (!rateLimitResult.allowed || rateLimitResult.waitMs > 0)) {
    const blocked = !rateLimitResult.allowed;
    const delayMs = rateLimitResult.waitMs;
    const scheduledAt = new Date(Date.now() + delayMs);

    if (blocked) {
    console.warn(`🚨 Rate limit of ${data.hourlyLimit || email.hourlyLimit || sender.hourlyLimit}/hr reached for sender ${sender.email}. Rescheduling job into next hour window.`);

    // Send Live Slack Alert
    void sendSlackRateLimitAlert({
      senderId: sender.id,
      senderEmail: sender.email,
      senderName: sender.name,
      hourlyLimit: data.hourlyLimit || email.hourlyLimit || sender.hourlyLimit,
      currentCount: rateLimitResult.currentCount,
      hourWindow: rateLimitResult.hourWindow,
      userId: email.userId || undefined,
    }).catch((error) => {
      console.error('⚠️ Slack rate-limit notification task failed:', error.message);
    });
    } else {
      console.info(`⏱️ Sender pacing slot reserved for ${sender.email}; delaying ${delayMs}ms.`);
    }

    const updatedEmail = await prisma.email.update({
      where: { id: emailId },
      data: { status: 'SCHEDULED', scheduledAt },
      include: { sender: true }
    });

    await indexEmailDoc(updatedEmail);

    if (!job?.token) {
      throw new Error('Cannot safely reschedule an active BullMQ job without its lock token.');
    }
    await job.moveToDelayed(scheduledAt.getTime(), job.token);
    throw new DelayedError();
  }

  const minimumDelayMs = data.minimumDelayMs ?? email.delayBetweenMs ?? Math.max(0, delayBetweenSec || 0) * 1000;
  const sendLock = await acquireSenderSendLock({
    senderId: sender.id,
    minimumDelayMs,
  });

  if (!sendLock.acquired) {
    const scheduledAt = new Date(Date.now() + Math.max(50, sendLock.retryAfterMs));
    const updatedEmail = await prisma.email.update({
      where: { id: emailId },
      data: { status: 'SCHEDULED', scheduledAt },
      include: { sender: true },
    });
    await indexEmailDoc(updatedEmail);
    if (!job?.token) {
      throw new Error('Cannot safely reschedule an active BullMQ job without its lock token.');
    }
    await job.moveToDelayed(scheduledAt.getTime(), job.token);
    throw new DelayedError();
  }

  try {
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "Email"
      SET "status" = 'SENDING',
          "attempts" = "attempts" + 1,
          "sending_started_at" = NOW()
      WHERE "id" = ${emailId}
        AND "status" = 'SCHEDULED'
      RETURNING "id"
    `);
    if (claimed.length === 0) {
      console.info(`ℹ️ Email ${emailId} was claimed or sent by another worker; skipping.`);
      return;
    }

    const deterministicMessageId = `<reachinbox-${emailId}@reachinbox.local>`;
    // 5. Dispatch Email via Ethereal SMTP
    const smtpRes = await sendEmailViaEthereal({
      smtpUser: sender.smtpUser,
      smtpPass: sender.smtpPass,
      smtpHost: sender.smtpHost,
      smtpPort: sender.smtpPort,
      fromName: sender.name,
      fromEmail: sender.email,
      toEmail: email.recipient,
      subject: email.subject,
      body: email.body,
      messageId: deterministicMessageId,
    });

    const beforeMessageIdPauseMs = Math.max(0, Number.parseInt(process.env.SMTP_TEST_PAUSE_BEFORE_MESSAGE_ID_MS || '0', 10));
    if (beforeMessageIdPauseMs > 0) await new Promise((resolve) => setTimeout(resolve, beforeMessageIdPauseMs));
    await prisma.email.update({ where: { id: emailId }, data: { messageId: smtpRes.messageId } });
    const afterMessageIdPauseMs = Math.max(0, Number.parseInt(process.env.SMTP_TEST_PAUSE_AFTER_MESSAGE_ID_MS || '0', 10));
    if (afterMessageIdPauseMs > 0) await new Promise((resolve) => setTimeout(resolve, afterMessageIdPauseMs));

    // 6. Update DB to SENT with preview URL
    const updatedEmail = await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        etherealPreviewUrl: smtpRes.previewUrl ? String(smtpRes.previewUrl) : null,
      },
      include: { sender: true }
    });

    // 7. Index in Elasticsearch
    await indexEmailDoc(updatedEmail);

  } catch (error: any) {
    console.error(`❌ SMTP Sending failed for email ${emailId}:`, error.message);
    const persistedSend = await prisma.email.findUnique({ where: { id: emailId } });
    if (persistedSend?.messageId) {
      const reconciled = await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'SENT',
          sentAt: persistedSend.sentAt || persistedSend.sendingStartedAt || new Date(),
          sendingStartedAt: null,
        },
        include: { sender: true },
      });
      await indexEmailDoc(reconciled);
      console.info(`✅ Reconciled ${emailId} as sent using persisted Message-ID ${persistedSend.messageId}.`);
      return;
    }
    const attempts = job?.opts.attempts ?? 1;
    if (job && job.attemptsMade + 1 < attempts) {
      await prisma.email.update({
        where: { id: emailId },
        data: { status: 'SCHEDULED', sendingStartedAt: null, messageId: null, failureReason: error.message },
      });
      throw error;
    }

    const failedEmail = await prisma.email.update({
      where: { id: emailId },
      data: { status: 'FAILED', sendingStartedAt: null, failureReason: error.message },
      include: { sender: true },
    });
    await indexEmailDoc(failedEmail);
  } finally {
    if (sendLock.token) {
      await releaseSenderSendLock(sender.id, sendLock.token).catch((error) => {
        console.warn(`⚠️ Could not release sender send lock for ${sender.email}:`, error.message);
      });
    }
  }
}
