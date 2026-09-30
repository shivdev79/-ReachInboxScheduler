# ReachInbox Backend

This is the Express + TypeScript backend for the ReachInbox email scheduler. It handles authentication, scheduling, persistence, Redis-backed queueing, rate limiting, worker processing, and Elasticsearch indexing.

## Stack

- TypeScript + Express
- PostgreSQL + Prisma
- Redis + BullMQ
- Elasticsearch
- Nodemailer + Ethereal Email
- JWT-based auth cookies

## Prerequisites

- Node.js 20+
- Docker Desktop or Docker Engine
- PostgreSQL, Redis, and Elasticsearch via Docker Compose

## 1) Start infrastructure

From the workspace root:

```bash
docker compose up -d --wait postgres redis elasticsearch
```

This starts:
- PostgreSQL on localhost:5432
- Redis on localhost:6380
- Elasticsearch on localhost:9200

## 2) Configure environment

Copy the sample env file:

```bash
cd backend
cp .env.example .env
```

Update values in `.env`:

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/reachinbox_db?schema=public"
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=
ELASTICSEARCH_NODE=http://localhost:9200
JWT_SECRET=replace_with_a_unique_random_secret
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
WORKER_CONCURRENCY=3
MIN_DELAY_BETWEEN_EMAILS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=5
SMTP_MODE=ethereal
SENDING_RECOVERY_TIMEOUT_MS=30000
BULLMQ_LOCK_DURATION_MS=30000
BULLMQ_LOCK_RENEW_TIME_MS=15000
BULLMQ_STALLED_INTERVAL_MS=1000
```

## 3) Install and initialize backend

```bash
cd backend
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
```

The seed script creates:
- a demo user: `demo@reachinbox.com`
- two Ethereal senders for testing

## 4) Run backend + worker

```bash
cd backend
npm run dev
```

This starts:
- Express API
- BullMQ worker
- startup recovery logic
- Elasticsearch initialization
- Bull Board at `/admin/queues`

Health checks:

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{"status":"ok"}
```

## 5) Auth routes

- `POST /api/auth/email/register`
- `POST /api/auth/email/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`

## 6) Email scheduling API

- `POST /api/emails/schedule`
- `GET /api/emails/scheduled`
- `GET /api/emails/sent`
- `GET /api/emails/search`

Example request:

```bash
curl -X POST http://localhost:5000/api/emails/schedule \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=..." \
  -d '{
    "subject": "Hello",
    "body": "Demo email",
    "recipients": ["a@example.com", "b@example.com"],
    "senderId": "<sender-id>",
    "startTime": "2026-09-30T12:00:00.000Z",
    "delayBetweenSec": 2,
    "hourlyLimit": 5
  }'
```

## Architecture overview

```text
Express API
  -> Prisma/PostgreSQL storage
  -> BullMQ delayed jobs in Redis
  -> worker processes jobs
  -> rate limit checks and sender lock acquisition
  -> SMTP via Ethereal
  -> status updates in DB
  -> Elasticsearch indexing
```

## Scheduling model

- No cron jobs are used.
- The API stores each email row in PostgreSQL.
- Each row is added to BullMQ with a delayed job.
- When due, the worker checks rate limiting, sender pacing, and lock ownership.
- If the job is still valid, it sends via the configured sender SMTP account.
- The worker updates PostgreSQL and Elasticsearch.

## Persistence on restart

The app restores job state on startup:

- Redis-backed BullMQ queue is recovered via persistent job state.
- PostgreSQL stores email status and idempotency keys.
- If a worker crashes while a job is `SENDING`, the app reconciles stale rows using persisted message IDs or requeues them after a recovery timeout.
- This prevents duplicate or lost sends during restarts.

## Rate limiting and concurrency

The backend enforces sender-level rate limits using Redis-backed counters keyed by sender and UTC hour window.

Important rules:
- configurable hourly send cap per sender
- lock enforced so only one sender send can happen at a time
- minimum delay between sends to mimic provider throttling
- when the hourly limit is reached, jobs are moved to the next hour instead of being dropped
- Slack alerts are emitted only when a webhook is connected

## BullMQ dashboard

Authenticated users can view the live queue dashboard at:

```text
http://localhost:5000/admin/queues
```

## Ethereal setup

1. Create a free Ethereal account at https://ethereal.email/
2. Create a sender record or run `npm run prisma:seed`
3. The generated SMTP credentials are stored in PostgreSQL
4. Use these values in your sender config when creating new senders

Ethereal is a fake SMTP service for testing; it does not deliver real emails.

## Feature list

### Backend features
- scheduler API
- PostgreSQL persistence
- BullMQ delayed jobs
- restart recovery
- idempotency protection
- per-sender rate limiting
- minimum delay enforcement
- concurrency-safe worker logic
- Elasticsearch indexing
- Slack notification support
- live queue dashboard

## Notes

- Do not commit `.env` files.
- Keep credentials out of source control.
- Use local Docker services for development and testing.
