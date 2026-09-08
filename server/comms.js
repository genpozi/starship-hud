/**
 * COMMS // Email + calendar adapters (Gmail, Microsoft Graph, ICS, webhook).
 *
 * Same contract as github.js: env-driven, seed fallback, no extra npm deps,
 * never crash the orbit on upstream failure. Live rows share the HUD seed
 * shape so renderers never branch on source.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.STELLARIS_DATA_DIR ? join(process.env.STELLARIS_DATA_DIR) : join(__dirname, '..', 'data')
const CURSOR_FILE = join(DATA_DIR, 'comms-cursor.json')

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const GCAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary'
const MS_GRAPH = 'https://graph.microsoft.com/v1.0'
const TITLE_MAX = 72
const MAIL_CAP = 40
const EVENT_CAP = 60

let syncTimer = null
const tokenCache = { google: null, microsoft: null }

/* ============================================================================
   CONFIG
   ============================================================================ */
export function getConfig() {
  const google = Boolean(
    process.env.USER_GOOGLE_CLIENT_ID && process.env.USER_GOOGLE_CLIENT_SECRET && process.env.USER_GOOGLE_REFRESH_TOKEN
  )
  const microsoft = Boolean(
    process.env.USER_MS_CLIENT_ID && process.env.USER_MS_CLIENT_SECRET && process.env.USER_MS_REFRESH_TOKEN
  )
  const ics = Boolean(process.env.USER_ICS_URL)
  const pollMs = Number(process.env.USER_COMMS_POLL_MS) > 0 ? Number(process.env.USER_COMMS_POLL_MS) : 120000
  const webhookSecret = process.env.USER_COMMS_WEBHOOK_SECRET || ''

  const emailPref = String(process.env.USER_COMMS_EMAIL_PROVIDER || 'auto').toLowerCase()
  const calPref = String(process.env.USER_COMMS_CALENDAR_PROVIDER || 'auto').toLowerCase()

  const emailProvider =
    emailPref === 'google' && google ? 'google'
      : emailPref === 'microsoft' && microsoft ? 'microsoft'
        : emailPref === 'auto' ? (google ? 'google' : microsoft ? 'microsoft' : null)
          : null

  const calendarProvider =
    calPref === 'google' && google ? 'google'
      : calPref === 'microsoft' && microsoft ? 'microsoft'
        : calPref === 'ics' && ics ? 'ics'
          : calPref === 'auto' ? (google ? 'google' : microsoft ? 'microsoft' : ics ? 'ics' : null)
            : null

  return {
    google,
    microsoft,
    ics,
    pollMs,
    webhookSecret,
    emailProvider,
    calendarProvider,
    enabled: Boolean(emailProvider || calendarProvider)
  }
}

/* ============================================================================
   TIME / WEEK HELPERS
   ============================================================================ */
export function sundayIso(ref = new Date()) {
  const x = new Date(ref)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x.toISOString().slice(0, 10)
}

export function weekBounds(weekStart) {
  const start = new Date(`${weekStart || sundayIso()}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end, weekStart: weekStart || sundayIso(start) }
}

export function dayOfWeek(isoOrDate, weekStart) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  const { start } = weekBounds(weekStart)
  const diff = Math.floor((d.getTime() - start.getTime()) / 86400000)
  return diff
}

export function hhmm(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return '00:00'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function clockLabel(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return '--:--'
  return hhmm(d)
}

function truncate(s, n = TITLE_MAX) {
  const t = String(s || '').trim()
  return t.length > n ? t.slice(0, n) : t
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function labelFrom(subject, from) {
  const blob = `${subject} ${from}`.toLowerCase()
  if (/(security|advisory|cert|phishing|rotate)/.test(blob)) return 'SEC'
  if (/(pr |pull request|diff|commit|review)/.test(blob)) return 'CODE'
  if (/(report|digest|telemetry|weekly)/.test(blob)) return 'REPORT'
  if (/(deploy|canary|rollout|ops|pager)/.test(blob)) return 'OPS'
  if (/(agenda|standup|remind)/.test(blob)) return 'PM'
  return 'MAIL'
}

export function eventTypeFrom(title) {
  const t = String(title || '').toLowerCase()
  if (/(standup|planning|milestone|review|gate|focus)/.test(t)) return 'mil'
  return 'dep'
}

export function weekLabel(weekStart) {
  return `WEEK ${weekStart || sundayIso()}`
}

/* ============================================================================
   EMAIL MAPPERS
   ============================================================================ */
function headerOf(payload, name) {
  const headers = (payload && payload.headers) || []
  const hit = headers.find((h) => String(h.name || '').toLowerCase() === name.toLowerCase())
  return hit ? hit.value : ''
}

function gmailBody(payload) {
  if (!payload) return ''
  const decode = (data) => {
    if (!data) return ''
    try {
      return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) return decode(payload.body.data)
  const parts = payload.parts || []
  const plain = parts.find((p) => p.mimeType === 'text/plain')
  if (plain) return gmailBody(plain)
  const html = parts.find((p) => p.mimeType === 'text/html')
  if (html) return stripHtml(gmailBody(html))
  if (payload.body && payload.body.data) return decode(payload.body.data)
  return ''
}

export function mapGmailMessage(msg) {
  const payload = msg.payload || {}
  const from = headerOf(payload, 'From') || 'unknown'
  const to = headerOf(payload, 'To') || ''
  const subject = headerOf(payload, 'Subject') || '(no subject)'
  const body = gmailBody(payload) || msg.snippet || ''
  const ts = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date()
  const labels = msg.labelIds || []
  const folder = labels.includes('SENT') ? 'sent' : labels.includes('TRASH') ? 'archive' : 'inbox'
  return {
    id: `gm-${msg.id}`,
    from: truncate(from, 80),
    to,
    subject: truncate(subject),
    preview: truncate(msg.snippet || body, 140),
    body: truncate(body, 4000),
    time: clockLabel(ts),
    label: labelFrom(subject, from),
    read: !labels.includes('UNREAD'),
    prio: labels.includes('IMPORTANT') ? 'high' : 'med',
    folder,
    src: 'google'
  }
}

export function mapGraphMessage(msg) {
  const fromAddr = (msg.from && msg.from.emailAddress) || {}
  const from = fromAddr.address ? `${fromAddr.name || fromAddr.address} <${fromAddr.address}>` : (fromAddr.name || 'unknown')
  const to = ((msg.toRecipients || []).map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean) || []).join(', ')
  const subject = msg.subject || '(no subject)'
  const rawBody = msg.body && msg.body.contentType === 'html' ? stripHtml(msg.body.content) : (msg.body && msg.body.content) || msg.bodyPreview || ''
  const ts = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date()
  return {
    id: `ms-${msg.id}`,
    from: truncate(from, 80),
    to,
    subject: truncate(subject),
    preview: truncate(msg.bodyPreview || rawBody, 140),
    body: truncate(rawBody, 4000),
    time: clockLabel(ts),
    label: labelFrom(subject, from),
    read: !!msg.isRead,
    prio: String(msg.importance || '').toLowerCase() === 'high' ? 'high' : 'med',
    folder: 'inbox',
    src: 'microsoft'
  }
}

export function normalizeInbound(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const from = p.from || p.sender || p.From || 'inbound@external'
  const to = p.to || p.recipient || p.To || ''
  const subject = p.subject || p.Subject || '(inbound)'
  const body = p.body || p['stripped-text'] || p['body-plain'] || p.text || p.preview || ''
  const id = p.id ? String(p.id) : `wh-${Date.now()}`
  return {
    id: id.startsWith('wh-') ? id : `wh-${id}`,
    from: truncate(from, 80),
    to,
    subject: truncate(subject),
    preview: truncate(body, 140),
    body: truncate(body, 4000),
    time: clockLabel(p.time || p.timestamp || Date.now()),
    label: labelFrom(subject, from),
    read: false,
    prio: p.prio === 'high' ? 'high' : 'med',
    folder: 'inbox',
    src: 'webhook'
  }
}

export function localSentCopy({ to, subject, body }) {
  return {
    id: `local-${Date.now()}`,
    from: 'operator@stellaris.internal',
    to: String(to || ''),
    subject: truncate(subject || '(no subject)'),
    preview: truncate(body || '', 140),
    body: truncate(body || '', 4000),
    time: clockLabel(new Date()),
    label: labelFrom(subject, 'operator'),
    read: true,
    prio: 'med',
    folder: 'sent',
    src: 'local'
  }
}

/* ============================================================================
   CALENDAR MAPPERS
   ============================================================================ */
export function mapGmailEvent(ev, weekStart) {
  const startIso = (ev.start && (ev.start.dateTime || ev.start.date)) || ''
  const endIso = (ev.end && (ev.end.dateTime || ev.end.date)) || startIso
  const title = ev.summary || '(untitled)'
  const day = dayOfWeek(startIso, weekStart)
  return {
    id: `gcal-${ev.id}`,
    day,
    start: ev.start && ev.start.date ? '08:00' : hhmm(startIso),
    end: ev.end && ev.end.date ? '09:00' : hhmm(endIso),
    title: truncate(title),
    type: eventTypeFrom(title),
    agents: ['USER'],
    location: ev.location || '',
    allDay: Boolean(ev.start && ev.start.date && !ev.start.dateTime),
    isoStart: startIso,
    isoEnd: endIso,
    src: 'google'
  }
}

export function mapGraphEvent(ev, weekStart) {
  const startIso = (ev.start && ev.start.dateTime) || (ev.start && ev.start.date) || ''
  const endIso = (ev.end && ev.end.dateTime) || (ev.end && ev.end.date) || startIso
  const title = ev.subject || '(untitled)'
  const day = dayOfWeek(startIso, weekStart)
  return {
    id: `mcal-${ev.id}`,
    day,
    start: ev.isAllDay ? '08:00' : hhmm(startIso),
    end: ev.isAllDay ? '09:00' : hhmm(endIso),
    title: truncate(title),
    type: eventTypeFrom(title),
    agents: ['USER'],
    location: (ev.location && ev.location.displayName) || '',
    allDay: !!ev.isAllDay,
    isoStart: startIso,
    isoEnd: endIso,
    src: 'microsoft'
  }
}

export function parseIcs(text, weekStart) {
  const unfolded = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1)
  const events = []
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] || ''
    const field = (name) => {
      const re = new RegExp(`^${name}[^:]*:(.*)$`, 'im')
      const m = body.match(re)
      return m ? m[1].trim() : ''
    }
    const uid = field('UID') || `ics-${events.length}`
    const summary = field('SUMMARY') || '(untitled)'
    const location = field('LOCATION')
    const dtStart = field('DTSTART')
    const dtEnd = field('DTEND') || dtStart
    const startDate = icsDate(dtStart)
    const endDate = icsDate(dtEnd)
    if (!startDate) continue
    const day = dayOfWeek(startDate, weekStart)
    if (day < 0 || day > 6) continue
    const allDay = /^\d{8}$/.test(dtStart.replace(/Z$/, ''))
    events.push({
      id: `ics-${uid}`.slice(0, 80),
      day,
      start: allDay ? '08:00' : hhmm(startDate),
      end: allDay ? '09:00' : hhmm(endDate || startDate),
      title: truncate(summary),
      type: eventTypeFrom(summary),
      agents: ['USER'],
      location,
      allDay,
      isoStart: startDate.toISOString(),
      isoEnd: (endDate || startDate).toISOString(),
      src: 'ics'
    })
  }
  return events.slice(0, EVENT_CAP)
}

function icsDate(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^\d{8}$/.test(s)) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`)
  }
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function localEvent({ title, day, start, end, type, agents, weekStart }) {
  const { start: week0 } = weekBounds(weekStart)
  const d = new Date(week0)
  d.setDate(d.getDate() + Number(day || 0))
  const [sh = '09', sm = '00'] = String(start || '09:00').split(':')
  const [eh = '10', em = '00'] = String(end || '10:00').split(':')
  const isoStart = new Date(d)
  isoStart.setHours(Number(sh), Number(sm), 0, 0)
  const isoEnd = new Date(d)
  isoEnd.setHours(Number(eh), Number(em), 0, 0)
  return {
    id: `local-${Date.now()}`,
    day: Number(day) || 0,
    start: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
    end: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
    title: truncate(title || 'Untitled'),
    type: type === 'mil' || type === 'dep' ? type : eventTypeFrom(title),
    agents: Array.isArray(agents) && agents.length ? agents : ['USER'],
    location: '',
    allDay: false,
    isoStart: isoStart.toISOString(),
    isoEnd: isoEnd.toISOString(),
    src: 'local'
  }
}

export function mergeComms(existing, incoming) {
  const local = (existing || []).filter((row) => row && row.src === 'local')
  const incomingIds = new Set((incoming || []).map((r) => r.id))
  const keptLocal = local.filter((r) => !incomingIds.has(r.id))
  return [...(incoming || []), ...keptLocal]
}

export function inWeek(ev) {
  return Number.isInteger(ev.day) && ev.day >= 0 && ev.day <= 6
}

/* ============================================================================
   RFC822 / AUTH
   ============================================================================ */
export function buildRfc822({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    String(body || '')
  ]
  return lines.join('\r\n')
}

export function toBase64Url(text) {
  return Buffer.from(String(text), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function loadCursor() {
  try {
    if (existsSync(CURSOR_FILE)) return JSON.parse(readFileSync(CURSOR_FILE, 'utf8'))
  } catch {}
  return {}
}

function saveCursor(cursor) {
  try {
    mkdirSync(dirname(CURSOR_FILE), { recursive: true })
    writeFileSync(CURSOR_FILE, JSON.stringify(cursor, null, 2))
  } catch {}
}

async function refreshGoogle() {
  if (tokenCache.google && tokenCache.google.exp > Date.now() + 30000) return tokenCache.google.token
  const body = new URLSearchParams({
    client_id: process.env.USER_GOOGLE_CLIENT_ID,
    client_secret: process.env.USER_GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.USER_GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  })
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`google token ${res.status}`)
  const json = await res.json()
  tokenCache.google = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 }
  return tokenCache.google.token
}

async function refreshMicrosoft() {
  if (tokenCache.microsoft && tokenCache.microsoft.exp > Date.now() + 30000) return tokenCache.microsoft.token
  const tenant = process.env.USER_MS_TENANT || 'common'
  const body = new URLSearchParams({
    client_id: process.env.USER_MS_CLIENT_ID,
    client_secret: process.env.USER_MS_CLIENT_SECRET,
    refresh_token: process.env.USER_MS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/.default offline_access'
  })
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`microsoft token ${res.status}`)
  const json = await res.json()
  tokenCache.microsoft = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 }
  return tokenCache.microsoft.token
}

async function gmailGet(path, token) {
  const res = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`gmail ${res.status}`)
  return res.json()
}

async function gcalGet(path, token) {
  const res = await fetch(`${GCAL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`gcal ${res.status}`)
  return res.json()
}

async function graphGet(path, token) {
  const res = await fetch(`${MS_GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`graph ${res.status}`)
  return res.json()
}

/* ============================================================================
   FETCHERS
   ============================================================================ */
export async function fetchInbox(cfg = getConfig()) {
  if (cfg.emailProvider === 'google') {
    const token = await refreshGoogle()
    const list = await gmailGet('/messages?maxResults=20&q=in:inbox', token)
    const ids = (list.messages || []).map((m) => m.id)
    const rows = []
    for (const id of ids) {
      const msg = await gmailGet(`/messages/${id}?format=full`, token)
      rows.push(mapGmailMessage(msg))
    }
    return rows
  }
  if (cfg.emailProvider === 'microsoft') {
    const token = await refreshMicrosoft()
    const json = await graphGet('/me/messages?$top=20&$select=id,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead,importance', token)
    return (json.value || []).map(mapGraphMessage)
  }
  return null
}

export async function fetchEvents(cfg = getConfig(), weekStart) {
  const { start, end, weekStart: ws } = weekBounds(weekStart)
  if (cfg.calendarProvider === 'google') {
    const token = await refreshGoogle()
    const qs = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50'
    })
    const json = await gcalGet(`/events?${qs}`, token)
    return (json.items || []).map((ev) => mapGmailEvent(ev, ws)).filter(inWeek)
  }
  if (cfg.calendarProvider === 'microsoft') {
    const token = await refreshMicrosoft()
    const qs = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      $top: '50',
      $select: 'id,subject,start,end,location,isAllDay'
    })
    const json = await graphGet(`/me/calendarView?${qs}`, token)
    return (json.value || []).map((ev) => mapGraphEvent(ev, ws)).filter(inWeek)
  }
  if (cfg.calendarProvider === 'ics') {
    const headers = {}
    if (process.env.USER_ICS_USER) {
      const basic = Buffer.from(`${process.env.USER_ICS_USER}:${process.env.USER_ICS_PASSWORD || ''}`).toString('base64')
      headers.Authorization = `Basic ${basic}`
    }
    const res = await fetch(process.env.USER_ICS_URL, { headers })
    if (!res.ok) throw new Error(`ics ${res.status}`)
    const text = await res.text()
    return parseIcs(text, ws)
  }
  return null
}

/* ============================================================================
   MUTATIONS AGAINST PROVIDERS
   ============================================================================ */
export async function sendMail({ to, subject, body }, cfg = getConfig()) {
  if (!to || !subject) return { ok: false, error: 'to and subject required' }
  const copy = localSentCopy({ to, subject, body })
  try {
    if (cfg.emailProvider === 'google') {
      const token = await refreshGoogle()
      const raw = toBase64Url(buildRfc822({ to, subject, body }))
      const res = await fetch(`${GMAIL_API}/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      })
      if (!res.ok) throw new Error(`gmail send ${res.status}`)
      const json = await res.json()
      copy.id = `gm-${json.id || copy.id}`
      copy.src = 'google'
      return { ok: true, email: copy, remote: true }
    }
    if (cfg.emailProvider === 'microsoft') {
      const token = await refreshMicrosoft()
      const res = await fetch(`${MS_GRAPH}/me/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'Text', content: body || '' },
            toRecipients: [{ emailAddress: { address: to } }]
          }
        })
      })
      if (!res.ok) throw new Error(`graph send ${res.status}`)
      copy.src = 'microsoft'
      return { ok: true, email: copy, remote: true }
    }
  } catch (err) {
    copy.src = 'local'
    return { ok: true, email: copy, remote: false, error: err.message }
  }
  return { ok: true, email: copy, remote: false, simulated: true }
}

export async function createRemoteEvent(event, cfg = getConfig()) {
  try {
    if (cfg.calendarProvider === 'google') {
      const token = await refreshGoogle()
      const res = await fetch(`${GCAL_API}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: event.title,
          start: { dateTime: event.isoStart },
          end: { dateTime: event.isoEnd }
        })
      })
      if (!res.ok) throw new Error(`gcal create ${res.status}`)
      const json = await res.json()
      return { ...event, id: `gcal-${json.id || event.id}`, src: 'google' }
    }
    if (cfg.calendarProvider === 'microsoft') {
      const token = await refreshMicrosoft()
      const res = await fetch(`${MS_GRAPH}/me/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: event.title,
          start: { dateTime: event.isoStart, timeZone: 'UTC' },
          end: { dateTime: event.isoEnd, timeZone: 'UTC' }
        })
      })
      if (!res.ok) throw new Error(`graph create ${res.status}`)
      const json = await res.json()
      return { ...event, id: `mcal-${json.id || event.id}`, src: 'microsoft' }
    }
  } catch (err) {
    return { ...event, src: 'local', error: err.message }
  }
  return { ...event, src: 'local', simulated: true }
}

export async function archiveRemote(id, cfg = getConfig()) {
  const raw = String(id || '')
  try {
    if (raw.startsWith('gm-') && cfg.emailProvider === 'google') {
      const token = await refreshGoogle()
      const gid = raw.slice(3)
      const res = await fetch(`${GMAIL_API}/messages/${gid}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] })
      })
      if (!res.ok) throw new Error(`gmail archive ${res.status}`)
      return { ok: true, remote: true }
    }
    if (raw.startsWith('ms-') && cfg.emailProvider === 'microsoft') {
      const token = await refreshMicrosoft()
      const mid = raw.slice(3)
      const res = await fetch(`${MS_GRAPH}/me/messages/${mid}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true })
      })
      if (!res.ok) throw new Error(`graph archive ${res.status}`)
      return { ok: true, remote: true }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true, remote: false }
}

/* ============================================================================
   SYNC LOOP
   ============================================================================ */
export async function syncComms(orchestrator, cfg = getConfig()) {
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' }
  const weekStart = (orchestrator.s.calendar && orchestrator.s.calendar.weekStart) || sundayIso()
  const out = { email: null, calendar: null, errors: [] }
  if (cfg.emailProvider) {
    try {
      const rows = await fetchInbox(cfg)
      if (rows) out.email = rows.slice(0, MAIL_CAP)
    } catch (err) {
      out.errors.push(err.message)
    }
  }
  if (cfg.calendarProvider) {
    try {
      const rows = await fetchEvents(cfg, weekStart)
      if (rows) out.calendar = rows
    } catch (err) {
      out.errors.push(err.message)
    }
  }
  return out
}

export function applyCommsSync(state, result) {
  const now = new Date().toISOString()
  state.meta.comms = state.meta.comms || { email: 'seed', calendar: 'seed' }
  if (result.email) {
    state.email = mergeComms(state.email, result.email)
    state.meta.comms.email = result.email[0] ? result.email[0].src : 'seed'
    state.meta.comms.lastSync = now
  }
  if (result.calendar) {
    const weekStart = state.calendar.weekStart || sundayIso()
    state.calendar = {
      ...state.calendar,
      weekStart,
      weekLabel: weekLabel(weekStart),
      events: mergeComms(state.calendar.events, result.calendar)
    }
    state.meta.comms.calendar = result.calendar[0] ? result.calendar[0].src : 'seed'
    state.meta.comms.lastSync = now
  }
  if (result.errors && result.errors.length) {
    state.meta.comms.error = result.errors[0]
  } else if (result.email || result.calendar) {
    state.meta.comms.error = null
  }
  saveCursor({ lastSync: now, email: state.meta.comms.email, calendar: state.meta.comms.calendar })
  return state.meta.comms
}

export function startCommsSync({ orchestrator, intervalMs }) {
  const cfg = getConfig()
  if (!orchestrator.s.meta.comms) {
    orchestrator.s.meta.comms = { email: 'seed', calendar: 'seed', lastSync: null, error: null }
  }
  if (!orchestrator.s.calendar.weekStart) {
    orchestrator.s.calendar.weekStart = sundayIso()
    orchestrator.s.calendar.weekLabel = weekLabel(orchestrator.s.calendar.weekStart)
  }
  if (!cfg.enabled) {
    orchestrator.log('INFO', 'Comms sync disabled — no Google/Microsoft/ICS credentials; using seed inbox + calendar')
    return { stop() {} }
  }
  if (syncTimer) return { stop: stopSync }
  const ms = intervalMs || cfg.pollMs
  orchestrator.log('INFO', `Comms sync started — email=${cfg.emailProvider || 'off'} calendar=${cfg.calendarProvider || 'off'} every ${ms}ms`)
  const tick = async () => {
    try {
      const res = await syncComms(orchestrator, cfg)
      if (res.skipped) return
      applyCommsSync(orchestrator.s, res)
      if (orchestrator.store && typeof orchestrator.store.markDirty === 'function') orchestrator.store.markDirty()
      const nMail = res.email ? res.email.length : 0
      const nCal = res.calendar ? res.calendar.length : 0
      if (res.errors && res.errors.length) {
        orchestrator.log('WARN', `Comms sync partial — ${res.errors[0]}`)
      } else {
        orchestrator.log('INFO', `Comms sync OK — ${nMail} messages, ${nCal} events`)
      }
    } catch (err) {
      orchestrator.log('ERROR', `Comms sync error: ${err.message}`)
    }
  }
  syncTimer = setInterval(tick, ms)
  tick()
  return { stop: stopSync }
}

function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

loadCursor()
