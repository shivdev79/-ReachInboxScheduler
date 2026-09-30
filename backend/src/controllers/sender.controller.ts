import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCurrentHourWindow } from '../services/rate-limiter.service';
import { getRedisClient, checkRedisAvailable } from '../config/redis';
import { serializeBigInts } from '../utils/serialize-bigints';

export async function getSenders(req: Request, res: Response) {
  try {
    const senders = await prisma.sender.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, hourlyLimit: true, createdAt: true }
    });

    const currentHour = getCurrentHourWindow();
    const isRedis = checkRedisAvailable();
    const redis = isRedis ? getRedisClient() : null;

    const enrichedSenders = await Promise.all(
      senders.map(async (sender) => {
        let currentCount = 0;
        if (isRedis && redis) {
          const key = `ratelimit:sender:${sender.id}:${currentHour}`;
          const val = await redis.get(key);
          currentCount = val ? parseInt(val, 10) : 0;
        } else {
          const log = await prisma.rateLimitLog.findUnique({
            where: { senderId_hourWindow: { senderId: sender.id, hourWindow: currentHour } }
          });
          currentCount = log?.count || 0;
        }

        return {
          ...sender,
          currentHourCount: currentCount,
          usagePercentage: Math.min(100, Math.round((currentCount / sender.hourlyLimit) * 100)),
        };
      })
    );

    return res.json(serializeBigInts({ senders: enrichedSenders }));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
