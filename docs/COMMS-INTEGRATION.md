# STELLARIS-7 Comms Integration Plan

Wire the Email and Calendar HUD surfaces to the operator's real inbox and
calendar — same contract as GitHub/Hermes: env-driven, seed fallback, no extra
npm deps, HUD never goes dark.

## Why these providers

| Surface | Popular tools | Adapter | Why |
| --- | --- | --- | --- |
| Email | Gmail / Google Workspace | Gmail API REST | Largest operator inbox |
| Email | Outlook / Microsoft 365 | Graph `/me/messages` + `sendMail` | Second-largest inbox |
| Email | Mailgun / SendGrid / Postmark / any inbound hook | `POST /api/comms/inbound` | Catch-all without IMAP |
| Calendar | Google Calendar | Calendar API v3 | Default with Gmail |
| Calendar | Outlook Calendar | Graph `/me/events` + calendarView | Default with M365 |
| Calendar | Apple iCloud, Fastmail, Nextcloud, Outlook ICS | ICS / CalDAV GET | Zero-OAuth subscribe |

IMAP/SMTP raw clients are **not** in this slice. Gmail + Graph cover the
two inboxes operators actually use; ICS covers every other calendar that can
emit a feed. Inbound webhooks cover "dump mail into the HUD" without polling.

## Canonical HUD shapes

Live rows must match seed so renderers never branch on source.

```js
// email[]
{
  id, from, to, subject, preview, body, time, label, read, prio,
  folder,   // inbox | sent | archive
  src       // seed | google | microsoft | webhook | local
}

// calendar.events[]
{
  id, day, start, end, title, type, agents,
  location, allDay, isoStart, isoEnd,
  src       // seed | google | microsoft | ics | local
}
```

`day` is `0..6` (Sun..Sat) relative to `calendar.weekStart` (ISO date of the
Sunday that opens the displayed week). Weekend events render; seed events on
days 0-4 keep working.

## Architecture

```
Browser HUD                         Orbit server
┌─────────────────────┐  REST/WS    ┌──────────────────────────────────┐
│ Email inbox+compose │────────────►│ server/comms.js     facade       │
│ Calendar grid+create│  snapshot   │  providers/google.js             │
│ api.sendMail        │◄─ delta ───│  providers/microsoft.js          │
│ api.createEvent     │             │  providers/ics.js                │
└─────────────────────┘             │ orchestrator mutations           │
                                    │ skills: mail, calendar           │
                                    └──────────────────────────────────┘
```

Rules copied from `server/github.js`:

1. No credentials → seed data, `meta.comms = { email:'seed', calendar:'seed' }`.
2. Configured + healthy → replace seed-owned rows; keep `src:'local'` drafts
   the operator created in the HUD.
3. Upstream 4xx/5xx → log, keep last-known state, do not crash the orbit.
4. Poll interval env-overridable (`USER_COMMS_POLL_MS`, default 120s).
5. `STELLARIS_DATA_DIR` for any persisted etag/sync cursor.
6. Skills degrade to simulated writes when no provider is live.

## Env (operator-supplied, never committed)

```
USER_COMMS_EMAIL_PROVIDER=     # google | microsoft | auto
USER_COMMS_CALENDAR_PROVIDER=  # google | microsoft | ics | auto
USER_COMMS_POLL_MS=120000
USER_COMMS_WEBHOOK_SECRET=

USER_GOOGLE_CLIENT_ID=
USER_GOOGLE_CLIENT_SECRET=
USER_GOOGLE_REFRESH_TOKEN=

USER_MS_CLIENT_ID=
USER_MS_CLIENT_SECRET=
USER_MS_TENANT=common
USER_MS_REFRESH_TOKEN=

USER_ICS_URL=
USER_ICS_USER=
USER_ICS_PASSWORD=
```

`auto` picks the first fully-configured provider (Google, then Microsoft, then
ICS for calendar only).

## REST surface

| Method | Path | Body | Behavior |
| --- | --- | --- | --- |
| POST | `/api/email/:id/read` | — | Mark read (id, with numeric-index fallback) |
| POST | `/api/email/:id/archive` | — | Folder → archive; Gmail `TRASH` / Graph move |
| POST | `/api/email/send` | `{to,subject,body}` | Send via provider or local sent-copy |
| POST | `/api/calendar/events` | `{title,day,start,end,type?}` | Create event |
| POST | `/api/calendar/:day` | — | Select day `0-6` (unchanged) |
| POST | `/api/comms/inbound` | inbound payload | Webhook ingest; `X-Stellaris-Secret` |

## HUD work

- Email: real `body`, source badge, compose form, archive, selected-id.
- Calendar: 7-day grid, create form, source badge, week label from `weekStart`.
- Offline sim: local mutations only (same as kanban/alerts).

## Skills + planner

- `mail` — LINK. List/send. Simulated sent-copy when no provider.
- `calendar` — NUDGE. List/create. Simulated local event when no provider.
- Heuristic planner: `email|inbox|mail|reply` → mail; `meeting|calendar|agenda|schedule` → calendar.

## Tests

`test/comms.test.mjs` — pure mappers + merge + ICS parse + config guards.
Integration — send / create / archive / inbound secret.
`run-all.mjs` registers `comms`.

## Out of scope (next slice)

- Full IMAP/SMTP client
- CalDAV write (PUT)
- Multi-account inboxes
- Attachment upload
- Recurrence expansion beyond provider `singleEvents` / calendarView
