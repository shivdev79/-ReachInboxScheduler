# ReachInbox Email Scheduler

ReachInbox is an Express/TypeScript scheduler and Next.js dashboard. PostgreSQL stores email records, Redis/BullMQ persists delayed jobs and enforces pacing, Elasticsearch serves search, and Nodemailer sends through Ethereal in the demo configuration.

## Architecture

```text
Browser (Next.js)
    | authenticated HTTP
    v
Express API -------> PostgreSQL (users, senders, email state, idempotency)
    |                         ^
    +--> Elasticsearch        | worker status updates
    |                         |
    +--> Redis / BullMQ ------+--> Email worker --> SMTP / Ethereal
              |                    |       |
              | atomic Lua limits  |       +--> deterministic Message-ID
              |                    +--> per-user Slack webhook alert
              +--> delayed jobs and AOF persistence
```

## Scheduling And Delivery

Scheduling uses BullMQ delayed jobs; there is no periodic scheduler. The API bulk-inserts email rows, bulk-indexes them, and uses `Queue.addBulk()` with each row's `scheduledAt` as a delay. A worker checks the rate limit before dispatch. It then obtains an atomic per-sender Redis send lock, checks the last-start timestamp, and holds the lock through SMTP and status persistence so concurrent workers cannot start together. A bounded lock expiry recovers abandoned sends after a process crash.

The submission defaults are `WORKER_CONCURRENCY=3`, `MIN_DELAY_BETWEEN_EMAILS_MS=2000`, and `MAX_EMAILS_PER_HOUR_PER_SENDER=5`. That means a minimum of **2 seconds between sends from one sender**. Compose sends `delayBetweenSec` and `hourlyLimit` on each request, so those values override the backend globals and are persisted with the email row and queue payload. Direct API callers may omit them to use the configured global values.

Hourly reservations use one Redis Lua script and a UTC fixed-hour key, `rl:count:{senderId}:{hourWindowStartMs}`. The script increments atomically up to the limit and reserves a pacing slot. The key expires after two hours. The reserved window is also persisted on the email row and restored into the BullMQ payload, preventing restart recovery from counting the same email reservation again. Once the cap is reached, the job's database status remains `SCHEDULED` and BullMQ moves it to the next UTC hour; this is deferred work, not a failed send. A reservation counts against the limit even if SMTP later fails, favoring never exceeding the provider cap over maximizing successful sends. A separate `ratelimit-alert:sender:{senderId}:{hourWindow}` NX key limits Slack alerts to one per sender per hour window.

### Restart Persistence And Idempotency

- PostgreSQL stores email state; Redis persistence is enabled with AOF in Docker Compose.
- Each request's idempotency key is combined with the user and recipient index to form a deterministic per-email key. PostgreSQL enforces uniqueness on `(userId, idempotencyKey)` and the same value is BullMQ's `jobId`.
- The worker claims a row with a conditional SQL update from `SCHEDULED` to `SENDING`; only one worker can win that claim.
- Per-email hourly reservation state is persisted in PostgreSQL as well as Redis-backed queue data, so restart recovery does not consume the same sender quota a second time.
- SMTP receives a deterministic Message-ID. If a restart finds an old `SENDING` row with a stored Message-ID, recovery reconciles it to `SENT`. Without a stored Message-ID, recovery returns it to the queue after `SENDING_RECOVERY_TIMEOUT_MS`.
- SMTP and PostgreSQL cannot participate in one atomic transaction. A crash after provider acceptance but before persisting the Message-ID can cause a retry; deterministic Message-ID helps reconciliation but does not guarantee every SMTP provider deduplicates delivery.

### High Volume

Requests use Prisma `createMany`, Elasticsearch bulk indexing, and BullMQ `addBulk`, so 1,000+ recipients can be registered without one database/queue round trip per recipient. Queueing capacity does not bypass sender limits: with two senders capped at five per hour, at most ten are eligible in that UTC hour; the remainder stay delayed for later windows. Redis, PostgreSQL, Elasticsearch, provider quotas, and configured pacing determine throughput. Use the test verifier with `SMTP_MODE=stub` to check volume without external SMTP traffic.

## Setup

### 1. Start infrastructure

From the workspace root:

```bash
docker compose up -d --wait postgres redis elasticsearch
```

The compose file publishes PostgreSQL on `5432`, Redis on host port `6380`, and Elasticsearch on `9200`.

### 2. Configure and start the backend

Copy `backend/.env.example` to `backend/.env`, set a unique random `JWT_SECRET`, and configure Google OAuth before using Google login. Slack variables are needed only for Slack OAuth. Do not commit `.env` files.

```bash
cd backend
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

The seed command creates a demo user and two Ethereal senders; it needs outbound access to create Ethereal test accounts. Newly created Ethereal SMTP credentials are stored in the local PostgreSQL sender records, not in source control. The backend listens on `http://localhost:5000`. Both `GET /health` and `GET /api/health` are health probes. Elasticsearch may be unavailable at startup; the API logs that it is using database fallback search.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend API base defaults to `http://localhost:5000`; set `NEXT_PUBLIC_API_URL` only when the backend is elsewhere.

### 4. Configure Google login

Create a Google OAuth web client and register `http://localhost:5000/api/auth/google/callback` as its redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `backend/.env`. Add your account as a test user if the consent screen is in testing mode.

## Environment Variables

| Variable | Example/default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | Express port |
| `NODE_ENV` | `development` | Cookie security behavior |
| `FRONTEND_URL` | `http://localhost:3000` | CORS and OAuth return URL |
| `DATABASE_URL` | Docker PostgreSQL URL | Prisma database connection |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6380` | Redis connection from host |
| `REDIS_PASSWORD` | empty | Optional Redis password |
| `ELASTICSEARCH_NODE` | `http://localhost:9200` | Search and indexing endpoint |
| `JWT_SECRET` | required, unique random value | Signs and verifies auth cookies; there is no insecure fallback |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth app values | Google sign-in |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/api/auth/google/callback` | Google callback |
| `WORKER_CONCURRENCY` | `3` | BullMQ worker concurrency |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Global minimum sender pacing in milliseconds |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `5` | Global fixed-hour sender cap |
| `SMTP_MODE` | `ethereal` | `ethereal` sends to the Ethereal test service; `stub` records test acceptance in Redis |
| `SMTP_STUB_LATENCY_MS` | `0` | Artificial latency in stub mode |
| `SENDING_RECOVERY_TIMEOUT_MS` | `30000` | Age before stale `SENDING` rows are reconciled |
| `BULLMQ_LOCK_DURATION_MS` | `30000` | Active-job lock duration |
| `BULLMQ_LOCK_RENEW_TIME_MS` | `15000` | Worker lock renewal interval |
| `BULLMQ_STALLED_INTERVAL_MS` | `1000` | Stalled-job scan interval |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack app credentials | Slack OAuth; both are required to connect |
| `SLACK_REDIRECT_URI` | `http://localhost:5000/api/slack/callback` | Must exactly match Slack app settings |

`backend/.env.test` intentionally uses a compressed pacing value and SMTP stub. Do not use it as evidence for the real 2-second SMTP run.

### Ethereal Email Setup

Ethereal is a fake SMTP service: messages are captured for inspection and are not delivered to real recipients. The default `SMTP_MODE=ethereal` uses the SMTP host, port, username, and password saved on each sender row. The included `npm run prisma:seed` script calls Nodemailer's `createTestAccount()` to create two test accounts and stores their credentials in PostgreSQL. It requires outbound internet access during seeding. Open the `etherealPreviewUrl` returned for a sent message to inspect it.

No Ethereal credentials need to be copied into tracked files. For a local demo, run the seed command once and keep the generated SMTP credentials in the local database. If creating senders manually, create an Ethereal test account and enter its SMTP connection values into that sender record. `ETHEREAL_USER` and `ETHEREAL_PASS` in the sample env are informational placeholders; sender-specific credentials are used by the worker.

For fast local load checks only, set `SMTP_MODE=stub`. Stub mode records accepted message IDs in Redis and does not produce Ethereal preview links. Use `SMTP_MODE=ethereal` for the live fake-SMTP demo.

## Slack Setup

1. Create a Slack app and enable OAuth & Permissions.
2. Add `http://localhost:5000/api/slack/callback` as an OAuth redirect URL, and add `incoming-webhook` and `chat:write` scopes.
3. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and the exact matching `SLACK_REDIRECT_URI` in `backend/.env`, then start the backend.
4. Sign in to the dashboard, choose **Connect Slack**, authorize the app, and select a channel. The incoming webhook is stored for the authenticated user and is not returned by the session endpoint.
5. Exceed a sender's hourly limit. The worker posts one notification per sender/hour window asynchronously with a five-second HTTP timeout. If no webhook is connected, it logs that the alert was skipped. Slack HTTP failures are logged and caught; the email is deferred independently without waiting for Slack.
6. To disconnect through the API, make an authenticated `POST /api/slack/disconnect` request. Reconnecting updates the database immediately; no backend restart is required.

## Operational Endpoints

- `GET /health` and `GET /api/health`: process health.
- Authenticated `/admin/queues`: Bull Board view of waiting, active, completed, failed, and delayed jobs.
- Authenticated `/api/emails/scheduled`, `/api/emails/sent`, and `/api/emails/search`: dashboard email views and search.
- Email, sender, and Slack routes require an authenticated session. Slack OAuth validates a state cookie against the callback state parameter.

## Implemented Features

| Assignment area | Implemented behavior |
| --- | --- |
| Backend scheduling | Authenticated `POST /api/emails/schedule` stores per-recipient rows in PostgreSQL and queues delayed BullMQ jobs in bulk. |
| Persistence and recovery | PostgreSQL is the source of truth; Redis AOF persists queue state. Startup recovery restores scheduled jobs and reconciles stale sending rows using their persisted provider Message-ID when available. |
| Idempotency | A request idempotency key plus recipient index produces a deterministic per-email key. PostgreSQL uniqueness and BullMQ job IDs prevent duplicate queue entries; conditional row claims prevent two workers from sending the same row concurrently. |
| Rate limiting | Atomic Redis Lua reservations enforce configurable UTC fixed-hour limits per sender across worker processes. Over-limit jobs remain scheduled for the next hour rather than failing. |
| Pacing and concurrency | `WORKER_CONCURRENCY` configures BullMQ worker concurrency. Redis sender locks and pacing slots enforce the configured minimum delay between starts for each sender. BullMQ active-job locks default to 30 seconds and renew every 15 seconds. |
| Email transport | Sender-specific Ethereal SMTP credentials allow multiple sending identities. Sent rows include Ethereal preview URLs. |
| Search and queue visibility | Email changes are indexed in Elasticsearch for search. Authenticated Bull Board exposes live waiting, delayed, active, completed, and failed queue state. |
| Slack rate-limit alerts | Users can connect Slack through OAuth. The worker sends at most one alert per sender/hour window; disconnected or failed Slack delivery does not fail email jobs. |
| Authentication | Google OAuth authorization-code flow validates state and verifies the ID token server-side. The app also offers email/password account access for local development and smoke testing. Sessions use an HTTP-only cookie. |
| Frontend dashboard | Next.js dashboard displays the signed-in user's name, email, avatar or initials fallback, logout, sender usage, and Scheduled/Sent navigation. |
| Compose | Compose accepts recipients manually or through CSV/TXT upload, deduplicates valid addresses, edits subject/body, and configures send time, pacing, and hourly limit. |
| Email views | Scheduled and sent/failed messages display recipient, subject, time, and status, with search, loading, empty, refresh, and error states. |

## Verification Commands

Run the production builds from the repository root:

```bash
npm --prefix backend run build
npm --prefix frontend run build
```

There are no scheduled cron processes or cron libraries. BullMQ delayed jobs and Redis persistence handle future delivery and restart recovery.

## Before Publishing

- Keep `backend/.env`, `backend/.env.test`, and `frontend/.env.local` local; `.gitignore` excludes `.env` files.
- Use `backend/.env.example` as the placeholder template and configure real OAuth, JWT, and provider values only in local or deployment secrets.
- The default PostgreSQL password in `docker-compose.yml` is for local development only. Change it before exposing the database beyond a trusted development machine.
- Do not commit real Google or Slack credentials, Ethereal SMTP passwords, JWT secrets, cookies, access tokens, or Slack webhook URLs.

## Known Limitations

- Hourly limits use UTC fixed-hour windows, not a rolling 60-minute window.
- Provider acceptance and database persistence cannot be committed atomically; crash recovery is at-least-once in the ambiguous acceptance window.
- An SMTP provider may reject, throttle, or delay a message. A failed attempt still consumed an hourly reservation.
- Slack OAuth and live webhook delivery require credentials and a manually authorized workspace/channel.
- On Windows, Node's OS-level `SIGTERM` is not delivered as a catchable JavaScript signal; use Ctrl+C (`SIGINT`) for graceful local shutdown. The `SIGTERM` handler is intended for POSIX/container deployments and must be verified there.
- Elasticsearch is a search index, not the source of truth; PostgreSQL owns durable email status. Elasticsearch failures fall back to database search.
- A large queue can be accepted quickly but still take multiple rate-limit windows to deliver. Per-sender caps and pacing are intentional throughput limits.
