# ReachInbox Frontend

This is the Next.js frontend for the ReachInbox scheduler dashboard. It provides a login flow, dashboard, compose flow, and scheduled/sent views for the email system.

## Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- React server and client components

## Prerequisites

- Node.js 20+
- Backend running at `http://localhost:5000`

## 1) Install dependencies

```bash
cd frontend
npm install
```

## 2) Run frontend

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment variables

Create or update `.env.local` if needed:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

If the backend is hosted elsewhere, set the API URL to that host.

## Features implemented

### Frontend features
- Google login flow
- email/password registration and login
- logout via auth cookie
- dashboard navigation
- scheduled emails tab
- sent emails tab
- compose modal / form
- CSV or text recipient import
- validation for recipient addresses
- scheduled start time and delay selection
- per-sender hourly limit configuration
- loading states and empty states
- error handling
- details modal for sent jobs
- table/list views for email records

## API expectations

The frontend talks to:

- `GET /api/auth/me`
- `POST /api/auth/email/register`
- `POST /api/auth/email/login`
- `POST /api/auth/logout`
- `GET /api/senders`
- `POST /api/emails/schedule`
- `GET /api/emails/scheduled`
- `GET /api/emails/sent`
- `GET /api/emails/search`

## Compose flow

The compose UI allows users to:
- enter subject and body
- upload recipients file
- parse emails from CSV or plain text
- set start time
- define delay between sends
- set hourly cap
- schedule bulk email jobs

## Dashboard behavior

After login, the user sees:
- top bar with user avatar and logout
- scheduled jobs panel
- sent jobs panel
- compose action button
- live queue link when available

## Notes

- The app expects the backend to be running before opening the frontend.
- The frontend is built to work with the local demo stack and can be updated to a hosted backend via `NEXT_PUBLIC_API_URL`.
- No secrets should be committed to the frontend repository.
