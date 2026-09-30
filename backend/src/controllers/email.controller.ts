import { Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { addEmailJobsToQueueBulk } from '../queue/email.queue';
import { indexEmailDocs, searchEmails } from '../services/elasticsearch.service';
import { serializeBigInts } from '../utils/serialize-bigints';

export async function scheduleEmails(req: Request, res: Response) {
  try {
    const { subject, body, recipients, senderId, startTime, delayBetweenSec, hourlyLimit } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const legacyMinimumDelayMs = Number.parseInt(process.env.DEFAULT_MIN_DELAY_BETWEEN_EMAILS_SEC || '2', 10) * 1000;
    const defaultDelayMs = Math.max(0, Number.parseInt(
      process.env.MIN_DELAY_BETWEEN_EMAILS_MS || String(legacyMinimumDelayMs), 10,
    ));
    const requestedDelay = Number(delayBetweenSec);
    const effectiveDelayMs = delayBetweenSec !== undefined
      && Number.isFinite(requestedDelay)
      && requestedDelay >= 0
      ? requestedDelay * 1000
      : defaultDelayMs;
    const effectiveDelayBetweenSec = Math.ceil(effectiveDelayMs / 1000);
    const configuredHourlyLimit = Math.max(1, Number.parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || '5', 10));
    const requestedHourlyLimit = Number(hourlyLimit);
    const effectiveHourlyLimit = hourlyLimit !== undefined
      && Number.isFinite(requestedHourlyLimit)
      && requestedHourlyLimit > 0
      ? requestedHourlyLimit
      : configuredHourlyLimit;

    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Subject, body, and a non-empty list of recipient emails are required.' });
    }

    const sender = (senderId ? await prisma.sender.findUnique({ where: { id: senderId } }) : null)
      || await prisma.sender.findFirst();
    if (!sender) {
      return res.status(400).json({ error: 'No active sender available in system. Please seed or create a sender.' });
    }

    const scheduledDate = startTime ? new Date(startTime) : new Date();
    if (!Number.isFinite(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'startTime must be a valid date.' });
    }

    const now = Date.now();
    const baseDelayMs = Math.max(0, scheduledDate.getTime() - now);
    const requestKey = req.header('Idempotency-Key') || randomUUID();
    const requestRows = recipients
      .map((value: unknown, index: number) => ({ recipient: typeof value === 'string' ? value.trim() : '', index }))
      .filter(({ recipient }) => recipient.length > 0)
      .map(({ recipient, index }) => ({
        recipient,
        subject,
        body,
        status: 'SCHEDULED',
        scheduledAt: new Date(now + baseDelayMs + index * effectiveDelayMs),
        delayBetweenSec: effectiveDelayBetweenSec,
        delayBetweenMs: effectiveDelayMs,
        hourlyLimit: effectiveHourlyLimit,
        idempotencyKey: `email-${createHash('sha256').update(`${userId}:${requestKey}:${index}`).digest('hex')}`,
        senderId: sender.id,
        userId,
      }));

    const inserted = requestRows.length
      ? await prisma.email.createMany({ data: requestRows, skipDuplicates: true })
      : { count: 0 };
    const scheduledEmails = requestRows.length === 0 ? [] : await prisma.email.findMany({
      where: { userId, idempotencyKey: { in: requestRows.map((row) => row.idempotencyKey) } },
      include: { sender: true },
    });

    await indexEmailDocs(scheduledEmails);
    await addEmailJobsToQueueBulk(scheduledEmails.map((email) => ({
      data: {
        emailId: email.id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        senderId: email.senderId,
        delayBetweenSec: email.delayBetweenSec,
        minimumDelayMs: email.delayBetweenMs || email.delayBetweenSec * 1000,
        hourlyLimit: email.hourlyLimit || effectiveHourlyLimit,
        idempotencyKey: email.idempotencyKey,
        slotReservedWindowStartMs: email.rateLimitReservedWindowStartMs === null
          ? undefined
          : Number(email.rateLimitReservedWindowStartMs),
      },
      delayMs: Math.max(0, email.scheduledAt.getTime() - Date.now()),
    })));

    return res.status(inserted.count > 0 ? 201 : 200).json(serializeBigInts({
      message: `Successfully scheduled ${scheduledEmails.length} email job(s)`,
      count: scheduledEmails.length,
      createdCount: inserted.count,
      scheduledAt: scheduledDate,
      sender: { id: sender.id, name: sender.name, email: sender.email, hourlyLimit: effectiveHourlyLimit },
      emails: scheduledEmails,
    }));
  } catch (error: any) {
    console.error('❌ Error scheduling emails:', error);
    return res.status(500).json({ error: 'Failed to schedule emails', details: error.message });
  }
}

export async function getScheduledEmails(req: Request, res: Response) {
  try {
    const emails = await prisma.email.findMany({
      where: { userId: req.user?.id, status: { in: ['SCHEDULED', 'PENDING', 'DELAYED_RATE_LIMIT', 'PROCESSING', 'SENDING'] } },
      include: { sender: true },
      orderBy: { scheduledAt: 'asc' },
    });
    return res.json(serializeBigInts({ emails, count: emails.length }));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getSentEmails(req: Request, res: Response) {
  try {
    const emails = await prisma.email.findMany({
      where: { userId: req.user?.id, status: { in: ['SENT', 'FAILED'] } },
      include: { sender: true },
      orderBy: { sentAt: 'desc' },
    });
    return res.json(serializeBigInts({ emails, count: emails.length }));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export async function searchEmailsController(req: Request, res: Response) {
  try {
    const query = req.query.q as string || '';
    const status = req.query.status as string || 'ALL';
    const senderId = req.query.senderId as string || undefined;
    const page = parseInt(req.query.page as string || '1', 10);
    const result = await searchEmails({ query, status, senderId, page, userId: req.user!.id });
    return res.json(serializeBigInts(result));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
