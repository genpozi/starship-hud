/**
 * COMMS SUITE // Gmail/Graph/ICS mappers, merge, config, inbound, rfc822.
 * Pure unit tests — no network, no tokens.
 */
import {
  getConfig,
  mapGmailMessage,
  mapGraphMessage,
  mapGmailEvent,
  mapGraphEvent,
  parseIcs,
  normalizeInbound,
  mergeComms,
  localSentCopy,
  localEvent,
  labelFrom,
  eventTypeFrom,
  sundayIso,
  dayOfWeek,
  weekBounds,
  inWeek,
  buildRfc822,
  toBase64Url,
  applyCommsSync
} from '../server/comms.js'

process.env.TZ = 'UTC'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const saved = {
  g: process.env.USER_GOOGLE_CLIENT_ID,
  m: process.env.USER_MS_CLIENT_ID,
  i: process.env.USER_ICS_URL
}
process.env.USER_GOOGLE_CLIENT_ID = ''
process.env.USER_GOOGLE_CLIENT_SECRET = ''
process.env.USER_GOOGLE_REFRESH_TOKEN = ''
process.env.USER_MS_CLIENT_ID = ''
process.env.USER_MS_CLIENT_SECRET = ''
process.env.USER_MS_REFRESH_TOKEN = ''
process.env.USER_ICS_URL = ''
pass('getConfig disabled with no credentials', getConfig().enabled === false && getConfig().emailProvider === null)

pass('labelFrom security advisory → SEC', labelFrom('Security alert: advisory', 'github') === 'SEC')
pass('labelFrom PR review → CODE', labelFrom('PR #12 ready for review', 'coda') === 'CODE')
pass('eventTypeFrom standup → mil', eventTypeFrom('Fleet standup') === 'mil')
pass('eventTypeFrom generic → dep', eventTypeFrom('1:1 with LINK') === 'dep')

const gmail = mapGmailMessage({
  id: 'abc',
  snippet: 'Hello from orbit',
  internalDate: String(Date.parse('2026-09-06T09:14:00Z')),
  labelIds: ['INBOX', 'UNREAD'],
  payload: {
    headers: [
      { name: 'From', value: 'coda@stellaris.internal' },
      { name: 'To', value: 'ops@stellaris.internal' },
      { name: 'Subject', value: 'PR #482 ready' }
    ],
    mimeType: 'text/plain',
    body: { data: Buffer.from('Implemented chunked ingest.').toString('base64') }
  }
})
pass('gmail id gm- prefix', gmail.id === 'gm-abc')
pass('gmail unread + CODE label', gmail.read === false && gmail.label === 'CODE' && gmail.src === 'google')
pass('gmail body decoded', gmail.body.includes('chunked ingest'))
pass('gmail folder inbox', gmail.folder === 'inbox')

const graph = mapGraphMessage({
  id: 'xyz',
  subject: 'Weekly telemetry digest',
  bodyPreview: 'token spend',
  body: { contentType: 'html', content: '<p>token spend</p>' },
  from: { emailAddress: { name: 'SAGE', address: 'sage@stellaris.internal' } },
  toRecipients: [{ emailAddress: { address: 'ops@stellaris.internal' } }],
  receivedDateTime: '2026-09-06T08:30:00Z',
  isRead: true,
  importance: 'normal'
})
pass('graph id ms- prefix + REPORT', graph.id === 'ms-xyz' && graph.label === 'REPORT' && graph.read === true && graph.src === 'microsoft')

const ws = '2026-09-06'
const gcal = mapGmailEvent({
  id: 'evt1',
  summary: 'Release gate review',
  start: { dateTime: '2026-09-07T14:00:00Z' },
  end: { dateTime: '2026-09-07T15:00:00Z' },
  location: 'bridge'
}, ws)
pass('gcal maps day/type/src', gcal.src === 'google' && gcal.type === 'mil' && inWeek(gcal) && gcal.id === 'gcal-evt1')

const mcal = mapGraphEvent({
  id: 'e2',
  subject: '1:1 with CODA',
  start: { dateTime: '2026-09-08T09:00:00Z' },
  end: { dateTime: '2026-09-08T09:45:00Z' },
  isAllDay: false,
  location: { displayName: 'hangar' }
}, ws)
pass('graph event dep + mcal id', mcal.src === 'microsoft' && mcal.type === 'dep' && mcal.id === 'mcal-e2')

const ics = parseIcs(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:stand-1
SUMMARY:Fleet standup
DTSTART:20260906T083000Z
DTEND:20260906T090000Z
LOCATION:bridge
END:VEVENT
BEGIN:VEVENT
UID:old
SUMMARY:Last week
DTSTART:20260101T090000Z
DTEND:20260101T100000Z
END:VEVENT
END:VCALENDAR`, '2026-09-06')
pass('ics parses in-week only', ics.length === 1 && ics[0].title === 'Fleet standup' && ics[0].src === 'ics')

const inbound = normalizeInbound({ from: 'alerts@github.com', subject: 'Security alert: dependabot', body: 'two advisories' })
pass('inbound webhook id + SEC', inbound.src === 'webhook' && inbound.label === 'SEC' && inbound.read === false && inbound.id.startsWith('wh-'))

const merged = mergeComms(
  [{ id: 'local-1', src: 'local' }, { id: 'seed-e1', src: 'seed' }],
  [{ id: 'gm-1', src: 'google' }]
)
pass('merge keeps local, drops seed, adds google', merged.length === 2 && merged[0].id === 'gm-1' && merged[1].id === 'local-1')

const sent = localSentCopy({ to: 'ops@x', subject: 'ping', body: 'hello' })
pass('local sent-copy folder sent', sent.folder === 'sent' && sent.src === 'local' && sent.to === 'ops@x')

const ev = localEvent({ title: 'Deep-focus', day: 0, start: '11:00', end: '12:30', weekStart: '2026-09-06' })
pass('local event day/start', ev.day === 0 && ev.start === '11:00' && ev.src === 'local' && ev.type === 'mil')

pass('sundayIso is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(sundayIso(new Date('2026-09-09T12:00:00Z'))))
pass('dayOfWeek sunday of weekStart is 0', dayOfWeek('2026-09-06T08:00:00', '2026-09-06') === 0)
pass('weekBounds spans 7 days', weekBounds('2026-09-06').end.getTime() - weekBounds('2026-09-06').start.getTime() === 7 * 86400000)

const rfc = buildRfc822({ to: 'a@b.c', subject: 'Hi', body: 'yo' })
pass('rfc822 has To/Subject/body', rfc.includes('To: a@b.c') && rfc.includes('Subject: Hi') && rfc.includes('yo'))
pass('base64url has no plus/slash', !toBase64Url('??>>').includes('+') && !toBase64Url('??>>').includes('/'))

const state = { meta: {}, email: [{ id: 'seed-e1', src: 'seed' }], calendar: { events: [{ id: 'seed-c1', src: 'seed' }], day: 0 } }
applyCommsSync(state, { email: [{ id: 'gm-1', src: 'google' }], calendar: [{ id: 'gcal-1', src: 'google', day: 1 }], errors: [] })
pass('applyCommsSync flips meta.comms', state.meta.comms.email === 'google' && state.meta.comms.calendar === 'google')
pass('applyCommsSync preserves local-only rows already merged', Array.isArray(state.email) && state.email[0].id === 'gm-1')

process.env.USER_GOOGLE_CLIENT_ID = saved.g
process.env.USER_MS_CLIENT_ID = saved.m
process.env.USER_ICS_URL = saved.i

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
