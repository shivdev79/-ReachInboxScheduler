# ReachInbox Five-Minute Demo

Prerequisites: Docker services are healthy; backend and frontend are running; Google OAuth is configured; the database is freshly seeded; SMTP mode is `ethereal`; sender defaults are 2 seconds and 5 emails per UTC hour; Slack OAuth credentials are configured and a channel is authorized. Use test addresses ending in `.example.test` so messages remain in the Ethereal test inbox.

1. **Sign in (0:00-0:30).** Open `http://localhost:3000/login` and sign in with the configured Google test account. Confirm the dashboard loads and displays the seeded senders.
2. **Connect Slack (0:30-1:00).** Choose **Connect Slack**, authorize the app, and select the demo channel. Confirm the dashboard returns with Slack connected.
3. **Compose from CSV (1:00-1:40).** Choose **Compose New Email**, upload a CSV containing eight unique `.example.test` addresses, enter a subject/body, select the fresh `ReachInbox Outreach Alpha` sender, retain the 2-second delay and 5/hour limit, then schedule.
4. **Inspect Scheduled (1:40-2:00).** Open the Scheduled tab. Confirm all eight rows are visible; five are eligible in the current hour and the remainder will move to the next UTC window.
5. **Inspect Bull Board (2:00-2:20).** Open `http://localhost:5000/admin/queues` in the authenticated browser session. Show delayed and active jobs. Bull Board is protected by the same session authentication.
6. **Restart mid-run (2:20-3:00).** After the first one or two messages are sent, stop the backend with Ctrl+C and start it again with `npm run dev`. Show startup recovery restoring pending jobs. Do not stop Redis or PostgreSQL.
7. **Show the rate-limit alert (3:00-3:30).** Wait for the sender's fifth hourly reservation. The remaining jobs stay scheduled for the next UTC hour and one Slack alert is posted for that sender/window. Show the worker's successful Slack dispatch log and the channel message identifying the sender, hourly limit, window, and reschedule action.
8. **Inspect Sent (3:30-4:10).** Open Sent. Confirm five sent rows and their Ethereal preview links. Open one preview in Ethereal to show the rendered test message.
9. **Search (4:10-4:40).** Search for the unique subject from Compose. Confirm results come from Elasticsearch and include sent/deferred records with their current statuses.
10. **Close out (4:40-5:00).** Return to Scheduled and show that no row was lost or duplicated during restart. Explain that deferred emails become eligible in the next UTC hour; do not wait for the full hour during the demo.

If Slack credentials are unavailable, skip the live Slack step and do not claim notification delivery. The rate-limit worker logs that Slack was skipped when no webhook is connected; email scheduling is independent of Slack delivery.
