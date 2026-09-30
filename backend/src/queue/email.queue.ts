import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis';
import { prisma } from '../config/prisma';

export const QUEUE_NAME = 'email-scheduler-queue';

export let emailQueue: Queue | null = null;

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  body: string;
  senderId: string;
  delayBetweenSec: number;
  minimumDelayMs?: number;
  hourlyLimit?: number;
  idempotencyKey: string;
  slotReservedWindowStartMs?: number;
  attemptCount?: number;
}

export function initEmailQueue() {
  emailQueue = new Queue(QUEUE_NAME, {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    }
  });
  console.log(`✅ BullMQ Queue '${QUEUE_NAME}' initialized`);
}

export async function addEmailJobToQueue(data: EmailJobData, delayMs: number, recoverStale = false) {
  if (emailQueue) {
    if (recoverStale) {
      const existingJob = await emailQueue.getJob(data.idempotencyKey);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'failed' || state === 'completed') {
          await existingJob.remove();
        }
      }
    }
    await emailQueue.add(`send-email-${data.emailId}`, data, {
      jobId: data.idempotencyKey,
      delay: Math.max(0, delayMs),
    });
    console.log(`📥 Enqueued BullMQ job for email ${data.emailId} (delay: ${delayMs}ms)`);
  } else {
    throw new Error('BullMQ queue is not initialized. Redis is required to schedule persistent email jobs.');
  }
}

export async function addEmailJobsToQueueBulk(jobs: Array<{ data: EmailJobData; delayMs: number }>) {
  if (!emailQueue) {
    throw new Error('BullMQ queue is not initialized. Redis is required to schedule persistent email jobs.');
  }
  if (jobs.length === 0) return;
  await emailQueue.addBulk(jobs.map(({ data, delayMs }) => ({
    name: `send-email-${data.emailId}`,
    data,
    opts: {
      jobId: data.idempotencyKey,
      delay: Math.max(0, delayMs),
    },
  })));
}

// Server restart recovery: Ensures future emails still send and non-sent emails aren't lost!
export async function recoverScheduledJobs() {
  try {
    const timeoutMs = Math.max(1000, Number.parseInt(process.env.SENDING_RECOVERY_TIMEOUT_MS || '30000', 10));
    const now = Date.now();
    const sendingEmails = await prisma.email.findMany({ where: { status: 'SENDING' }, include: { sender: true } });
    for (const email of sendingEmails) {
      const sendingAge = email.sendingStartedAt ? now - email.sendingStartedAt.getTime() : timeoutMs;
      if (sendingAge < timeoutMs) continue;
      if (email.messageId) {
        await prisma.email.update({
          where: { id: email.id },
          data: { status: 'SENT', sentAt: email.sentAt || email.sendingStartedAt || new Date() },
        });
        console.info(`✅ Recovered ${email.id} as SENT from stored provider messageId.`);
      } else {
        await prisma.email.update({ where: { id: email.id }, data: { status: 'SCHEDULED' } });
        console.warn(`♻️ Recovered stale SENDING row ${email.id} without messageId to SCHEDULED.`);
      }
    }

    await prisma.email.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'SCHEDULED' },
    });

    const pendingEmails = await prisma.email.findMany({
      where: {
        status: { in: ['SCHEDULED', 'SENDING'] }
      },
      include: { sender: true }
    });

    if (pendingEmails.length === 0) return;

    console.log(`🔄 Server Restart Recovery: Restoring ${pendingEmails.length} pending email jobs...`);
    for (const email of pendingEmails) {
      const scheduledTime = new Date(email.scheduledAt).getTime();
      const recoverAt = email.status === 'SENDING'
        ? (email.sendingStartedAt?.getTime() || now) + timeoutMs
        : scheduledTime;
      const delayMs = Math.max(0, Math.max(scheduledTime, recoverAt) - now);

      await addEmailJobToQueue({
        emailId: email.id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        senderId: email.senderId,
        delayBetweenSec: email.delayBetweenSec,
        minimumDelayMs: email.delayBetweenMs || email.delayBetweenSec * 1000,
        hourlyLimit: email.hourlyLimit || email.sender.hourlyLimit,
        idempotencyKey: email.idempotencyKey,
        slotReservedWindowStartMs: email.rateLimitReservedWindowStartMs === null
          ? undefined
          : Number(email.rateLimitReservedWindowStartMs),
      }, delayMs, true);
    }
    console.log(`✅ Server Restart Recovery complete. ${pendingEmails.length} jobs active.`);
  } catch (error) {
    console.error('❌ Error recovering scheduled jobs:', error);
  }
}
