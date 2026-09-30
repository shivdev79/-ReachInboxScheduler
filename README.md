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

### Component Responsibilities

- **Next.js frontend** owns the login, dashboard, compose editor, CSV/TXT recipient parsing, scheduled/sent views, and user-facing loading/error states. It calls the API with the HTTP-only session cookie.
- **Express API** validates authenticated requests, creates email records, bulk-enqueues BullMQ jobs, serves email/sender views, handles Google OAuth, and starts Slack OAuth.
- **PostgreSQL via Prisma** is the authoritative store for users, sender SMTP settings, message status/timestamps, idempotency keys, and the persisted hourly reservation timestamp.
- **Redis** backs BullMQ, atomic hourly quota reservations, per-sender pacing/locks, and one-alert-per-hour Slack deduplication. Docker Compose enables Redis AOF persistence.
- **BullMQ worker** consumes delayed jobs, applies rate/pacing checks, atomically claims each email row, sends via SMTP, updates PostgreSQL, and refreshes its Elasticsearch document.
- **Ethereal** captures test messages and returns preview URLs. It does not deliver to real recipient inboxes.
- **Elasticsearch** is a rebuildable search index; PostgreSQL remains the source of truth if Elasticsearch is unavailable.
- **Bull Board** provides an authenticated live view of BullMQ queue states at `/admin/queues`.

### Request And Recovery Flows

1. The compose form submits the selected sender, recipients, subject/body, start time, pacing, hourly limit, and an idempotency key to `POST /api/emails/schedule`.
2. The API creates one PostgreSQL email row per valid recipient, indexes the rows in bulk, and adds corresponding BullMQ delayed jobs. A future `scheduledAt` becomes the BullMQ delay; no cron loop polls for due messages.
3. At execution, a worker atomically reserves that sender's quota/pacing slot in Redis. If the hourly quota is exhausted, the row stays `SCHEDULED` and the job is moved to the next UTC hour. Otherwise, the worker obtains the sender lock and conditionally transitions the row to `SENDING` before contacting SMTP.
4. After provider acceptance, the worker persists the SMTP Message-ID, marks the row `SENT`, stores the Ethereal preview URL, and updates Elasticsearch. A provider error is recorded as `FAILED` after retries are exhausted; the reserved quota is not returned.
5. On startup, recovery reads PostgreSQL `SCHEDULED`/stale `SENDING` rows and restores missing BullMQ jobs. If a `SENDING` row has a persisted Message-ID, it reconciles the row as sent instead of sending again. If the process crashed before persisting acceptance, the row is eligible for retry after the configured recovery timeout.

The database and SMTP provider cannot share a transaction. As a result, exactly-once delivery cannot be guaranteed in the narrow interval where SMTP accepts a message but the process crashes before saving its Message-ID. The implementation uses deterministic Message-IDs, persisted state, conditional row claims, and BullMQ job IDs to minimize duplicates and recover safely; the provider must honor Message-ID deduplication for a strict external exactly-once guarantee.

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

## Setup Instructions

### 1. Start infrastructure

From the workspace root:

```bash
docker compose up -d --wait postgres redis elasticsearch
```

The compose file publishes PostgreSQL on `5432`, Redis on host port `6380`, and Elasticsearch on `9200`.

## Render Deployment

The repository includes separate Dockerfiles and `.dockerignore` files for the API/worker and Next.js frontend. Deploy the two services from the same GitHub repository in one Render region using the dashboard's Docker-service setup below. The email worker runs inside the backend web service process; do not create a second worker service unless you intentionally change the deployment topology.

### Create the data services

1. **PostgreSQL**: create a Render Postgres database. Use its internal connection string for the backend `DATABASE_URL`; keep the database and app in the same region.
2. **Key Value (Redis-compatible)**: create a Render Key Value instance in the same region. This is Valkey-compatible with ioredis. Choose a plan with persistence and select **Journal + Snapshot**; set the max-memory policy to `noeviction` for queue safety. Use the internal URL's hostname as `REDIS_HOST` and port `6379` as `REDIS_PORT`. Render's default internal URL does not require authentication; if you enable internal authentication, set the appropriate `REDIS_PASSWORD`.
3. **Elasticsearch**: create a private service from the existing image `docker.elastic.co/elasticsearch/elasticsearch:8.12.0`, in the same region, with a persistent disk mounted at `/usr/share/elasticsearch/data`. Set `discovery.type=single-node`, `xpack.security.enabled=false`, and `ES_JAVA_OPTS=-Xms512m -Xmx512m`. Keep the service private (no public domain). Name the private service `reachinbox-elasticsearch`, then set backend `ELASTICSEARCH_NODE=http://reachinbox-elasticsearch:9200`. Elasticsearch is memory-intensive; choose a plan with sufficient memory and check current Render pricing before creating resources.

Render Key Value persistence and persistent service disks may require paid plans. Review the plan and estimated cost for every service before provisioning. Do not use a non-persistent/free Redis plan for a production-like queue: losing Redis data can lose delayed jobs that have not yet been recovered from PostgreSQL.

### Deploy the backend

Create a Render **Web Service** from the private GitHub repository and configure:

- Runtime: **Docker**
- Root directory: `backend`
- Dockerfile path: `Dockerfile` (relative to the configured root directory)
- Health check path: `/health`
- `NODE_ENV=production`
- `DATABASE_URL`: Render Postgres internal connection string
- `REDIS_HOST`: Render Key Value internal hostname
- `REDIS_PORT=6379`
- `REDIS_PASSWORD`: only if internal Redis authentication is enabled
- `ELASTICSEARCH_NODE=http://<elasticsearch-private-host>:9200`
- `FRONTEND_URL`: the frontend's public HTTPS origin
- `JWT_SECRET`: a newly generated, unique secret stored as a Render secret
- `WORKER_CONCURRENCY=3`
- `MIN_DELAY_BETWEEN_EMAILS_MS=2000`
- `MAX_EMAILS_PER_HOUR_PER_SENDER=5`
- `SMTP_MODE=ethereal`
- `BULLMQ_LOCK_DURATION_MS=30000`
- `BULLMQ_LOCK_RENEW_TIME_MS=15000`

The backend image runs `prisma migrate deploy` before starting the Express API and BullMQ worker. Render sets `RENDER_EXTERNAL_URL` for a web service; the app uses it to derive the Google and Slack callbacks unless you explicitly set `GOOGLE_REDIRECT_URI` or `SLACK_REDIRECT_URI`. Once the backend has a public HTTPS domain, register these exact callback URLs in the provider consoles:

- Google: `https://<backend-domain>/api/auth/google/callback` (`GOOGLE_REDIRECT_URI`)
- Slack: `https://<backend-domain>/api/slack/callback` (`SLACK_REDIRECT_URI`)

Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through Render's secret environment-variable interface. Add Slack credentials only if enabling Slack for the demo. Keep provider redirect URLs exactly matching the provider console.

### Deploy the frontend

Create a second Render **Web Service** from the same repository:

- Runtime: **Docker**
- Root directory: `frontend`
- Dockerfile path: `Dockerfile` (relative to the configured root directory)
- Environment variable/build argument: `NEXT_PUBLIC_API_URL=https://<backend-domain>`

Render exposes configured environment variables to Docker builds as build arguments. The frontend Dockerfile embeds `NEXT_PUBLIC_API_URL` into the Next.js client bundle at build time. Redeploy the frontend after changing it. The `next start` command honors Render's assigned `PORT`.

### Initialize and verify

After the backend has deployed and its database connection is healthy, open the backend service Shell and run `npm run prisma:seed` once to create the demo user and two Ethereal senders. Seeding requires outbound access to Ethereal. Verify the backend at `https://<backend-domain>/health`, then test Google login, composing/scheduling, the scheduled/sent views, and Bull Board. Ethereal is a test inbox; messages are not delivered to real recipients.

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

## Feature Implementation

### Backend

| Assignment requirement | Implementation |
| --- | --- |
| Schedule email requests | Authenticated `POST /api/emails/schedule` validates the request, creates one PostgreSQL email row per recipient, and bulk-enqueues delayed BullMQ jobs. |
| Persistent delivery | PostgreSQL is the source of truth; Redis AOF persists BullMQ state. Startup recovery restores scheduled jobs and reconciles stale `SENDING` rows from persisted provider Message-IDs when available. |
| Idempotency | A request idempotency key plus recipient index creates a deterministic per-email key. PostgreSQL uniqueness, BullMQ job IDs, and conditional row claims prevent duplicate queue entries and concurrent sends of the same row. |
| Rate limiting | Atomic Redis Lua reservations enforce configurable UTC fixed-hour limits per sender across workers. Jobs above the cap remain scheduled for the next hour instead of being dropped or failed. |
| Pacing and concurrency | `WORKER_CONCURRENCY` controls worker concurrency. Redis sender locks and pacing slots enforce per-sender send spacing. BullMQ job locks default to 30 seconds and renew every 15 seconds. |
| SMTP and multiple senders | Each sender has its own Ethereal SMTP settings. Sent rows include Ethereal preview URLs; stub mode is available for high-volume local tests. |
| Search and queue visibility | Email documents are indexed in Elasticsearch. Authenticated Bull Board exposes waiting, delayed, active, completed, and failed jobs. |
| Slack alerts | Slack OAuth stores an incoming webhook per user. Rate-limit alerts are deduplicated per sender/hour; disconnected or failed Slack delivery does not fail email jobs. |

### Frontend

| Assignment requirement | Implementation |
| --- | --- |
| Login and account controls | Google OAuth login plus email/password development access; dashboard shows account name, email, avatar or initials fallback, and logout. |
| Dashboard navigation | Scheduled and Sent sections, sender usage, queue dashboard link, and primary Compose control. |
| Compose | Subject/body editor, recipient chips, CSV/TXT upload with valid-address detection and deduplication, sender selection, scheduled start time, delay, and hourly limit. |
| Rich-text editing | Formatting toolbar supports undo/redo, text styles, bold, italic, underline, alignment, lists, indentation, quote, code, links, images, and strikethrough. |
| Scheduled and sent views | Recipient, subject, scheduled/sent time, delivery status, and Ethereal preview links where available. |
| UX and search | Search, refresh, loading and empty states, success/error toasts, and email details view. | 

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
