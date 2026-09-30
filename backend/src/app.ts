import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { connectDB } from './config/prisma';
import { prisma } from './config/prisma';
import { getRedisClient } from './config/redis';
import { esClient, initElasticsearch } from './services/elasticsearch.service';
import { emailQueue, initEmailQueue, recoverScheduledJobs } from './queue/email.queue';
import { initEmailWorker } from './queue/email.worker';
import { requireAuth } from './middleware/auth';

import authRoutes from './routes/auth.routes';
import emailRoutes from './routes/email.routes';
import slackRoutes from './routes/slack.routes';
import senderRoutes from './routes/sender.routes';

dotenv.config();

const app = express();
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function startServer() {
  console.log('🚀 Initializing ReachInbox Email Scheduler Service...');

  // 1. Connect Database
  await connectDB();

  // 2. Connect Redis
  await getRedisClient().ping();

  // 3. Initialize BullMQ Queue & Worker
  initEmailQueue();

  // 4. Server Restart Job State Recovery
  await recoverScheduledJobs();

  const worker = initEmailWorker();

  // 5. Initialize Elasticsearch Indexer
  await initElasticsearch();

  // 6. Bull-Board Live Admin Dashboard
  if (emailQueue) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [new BullMQAdapter(emailQueue)],
      serverAdapter,
    });

    app.use('/admin/queues', requireAuth, serverAdapter.getRouter());
    console.log(`📊 BullMQ Live Queue Dashboard mounted at http://localhost:${PORT}/admin/queues`);
  }

  // 7. Mount API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/slack', slackRoutes);
  app.use('/api/senders', senderRoutes);

  app.get(['/health', '/api/health'], (req, res) => {
    res.json({ status: 'ok' });
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`✨ Server running and operational on http://localhost:${PORT}`);
  });

  let shutdownTask: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownTask) return shutdownTask;
    shutdownTask = (async () => {
      console.log(`🛑 Received ${signal}; starting graceful shutdown...`);
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          console.warn('⚠️ HTTP drain timed out; closing remaining connections.');
          httpServer.closeAllConnections();
          finish();
        }, 5000);
        timeout.unref();
        httpServer.close(() => finish());
        httpServer.closeIdleConnections();
      });

      const closeResource = async (name: string, close: () => Promise<unknown>) => {
        try {
          await close();
          console.log(`✅ Closed ${name}`);
        } catch (error) {
          process.exitCode = 1;
          console.error(`❌ Failed to close ${name}:`, error);
        }
      };

      await closeResource('BullMQ worker', () => worker.close());
      if (emailQueue) await closeResource('BullMQ queue', () => emailQueue!.close());
      await closeResource('Redis', () => getRedisClient().quit());
      await closeResource('Elasticsearch', () => esClient.close());
      await closeResource('Prisma', () => prisma.$disconnect());
      console.log('✅ Graceful shutdown complete');
    })();
    return shutdownTask;
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch((error) => {
        process.exitCode = 1;
        console.error('❌ Graceful shutdown failed:', error);
      });
    });
  }
}

startServer().catch((err) => {
  console.error('❌ Critical startup error:', err);
});
