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
  const caldav = Boolean(process.env.USER_CALDAV_URL)
  const pollMs = Number(process.env.USER_COMMS_POLL_MS) > 0 ? Number(process.env.USER_COMMS_POLL_MS) : 120000
  const webhookSecret = process.env.USER_COMMS_WEBHOOK_SECRET || ''

  const emailPref = String(process.env.USER_COMMS_EMAIL_PROVIDER || 'auto').toLowerCase()
  const calPref = String(process.env.USER_COMMS_CALENDAR_PROVIDER || 'auto').toLowerCase()

  const emailProviders = []
  if ((emailPref === 'auto' || emailPref === 'google') && google) emailProviders.push('google')
  if ((emailPref === 'auto' || emailPref === 'microsoft') && microsoft) emailProviders.push('microsoft')

  const calendarProviders = []
  if ((calPref === 'auto' || calPref === 'google') && google) calendarProviders.push('google')
  if ((calPref === 'auto' || calPref === 'microsoft') && microsoft) calendarProviders.push('microsoft')
  if ((calPref === 'auto' || calPref === 'ics' || calPref === 'caldav') && (ics || caldav)) calendarProviders.push(caldav && !ics ? 'caldav' : 'ics')

  const pick = (list) => (list.length === 1 ? list[0] : list.length > 1 ? 'mixed' : null)

  return {
    google,
    microsoft,
    ics,
    caldav,
    pollMs,
    webhookSecret,
    emailProviders,
    calendarProviders,
    emailProvider: pick(emailProviders),
    calendarProvider: pick(calendarProviders),
    enabled: Boolean(emailProviders.length || calendarProviders.length)
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

export function shiftWeek(weekStart, deltaWeeks) {
  const { start } = weekBounds(weekStart)
  start.setDate(start.getDate() + Number(deltaWeeks || 0) * 7)
  const next = sundayIso(start)
  return { weekStart: next, weekLabel: weekLabel(next) }
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

function gmailAttachments(payload) {
  const out = []
  const walk = (p) => {
    if (!p) return
    if (p.filename) out.push({ name: truncate(p.filename, 80), mime: p.mimeType || '', size: Number((p.body && p.body.size) || 0) })
    ;(p.parts || []).forEach(walk)
  }
  walk(payload)
  return out.slice(0, 8)
}

function normalizeAttachments(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((a) => a && (a.name || a.filename || a.data))
    .slice(0, 8)
    .map((a) => ({
      name: truncate(a.name || a.filename || 'file', 80),
      mime: String(a.mime || a.contentType || a.type || 'application/octet-stream'),
      size: Number(a.size || (a.data ? Buffer.byteLength(String(a.data), 'base64') : 0)),
      data: a.data ? String(a.data).slice(0, 350000) : undefined
    }))
}

export function capAttachments(list) {
  const out = []
  let total = 0
  for (const a of normalizeAttachments(list)) {
    const bytes = a.size || 0
    if (total + bytes > 200000) break
    total += bytes
    out.push(a)
  }
  return out
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
    src: 'google',
    attachments: gmailAttachments(payload)
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
    src: 'microsoft',
    attachments: msg.hasAttachments
      ? [{ name: 'attachment', mime: 'application/octet-stream', size: 0 }]
      : normalizeAttachments(msg.attachments)
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
    src: 'webhook',
    attachments: capAttachments(p.attachments)
  }
}

export function localSentCopy({ to, subject, body, attachments }) {
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
    src: 'local',
    attachments: capAttachments(attachments)
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

export function parseRrule(raw) {
  const out = { freq: null, interval: 1, count: null, until: null, byday: [] }
  String(raw || '').split(';').forEach((part) => {
    const [k, v] = part.split('=')
    if (!k || v == null) return
    const key = k.toUpperCase().trim()
    const val = v.trim()
    if (key === 'FREQ') out.freq = val.toUpperCase()
    if (key === 'INTERVAL') out.interval = Math.max(1, Number(val) || 1)
    if (key === 'COUNT') out.count = Math.max(1, Number(val) || 1)
    if (key === 'UNTIL') out.until = icsDate(val)
    if (key === 'BYDAY') out.byday = val.split(',').map((d) => d.trim().toUpperCase()).filter(Boolean)
  })
  return out
}

const BYDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

export function expandRrule(startDate, endDate, rrule, weekStart, { uid, summary, location, allDay } = {}) {
  if (!startDate || !rrule || !rrule.freq) return []
  const { start: week0, end: weekEnd } = weekBounds(weekStart)
  const duration = Math.max(0, (endDate || startDate).getTime() - startDate.getTime())
  const until = rrule.until && rrule.until < weekEnd ? rrule.until : weekEnd
  const occurrences = []
  const cursor = new Date(startDate)
  let emitted = 0
  const max = rrule.count || 366
  const byday = rrule.byday.map((d) => BYDAY_INDEX[d.replace(/^-?\d+/, '')]).filter((d) => d != null)
  const originSunday = weekBounds(sundayIso(startDate)).start
  const dayStep = (rrule.freq === 'WEEKLY' || rrule.freq === 'MONTHLY') && byday.length

  let guard = 0
  while (cursor < until && emitted < max && occurrences.length < 14 && guard < 800) {
    guard += 1
    const weekdayOk = !byday.length || byday.includes(cursor.getDay())
    let intervalOk = true
    if (rrule.freq === 'WEEKLY' && rrule.interval > 1) {
      const weeks = Math.round((weekBounds(sundayIso(cursor)).start - originSunday) / (7 * 86400000))
      intervalOk = weeks % rrule.interval === 0
    }
    if (weekdayOk && intervalOk && cursor >= startDate) {
      emitted += 1
      if (cursor >= week0 && cursor < weekEnd) {
        const instStart = new Date(cursor)
        const instEnd = new Date(instStart.getTime() + duration)
        const day = dayOfWeek(instStart, weekStart)
        if (day >= 0 && day <= 6) {
          occurrences.push({
            id: `ics-${uid}-${instStart.toISOString().slice(0, 10)}`.slice(0, 80),
            day,
            start: allDay ? '08:00' : hhmm(instStart),
            end: allDay ? '09:00' : hhmm(instEnd),
            title: truncate(summary),
            type: eventTypeFrom(summary),
            agents: ['USER'],
            location: location || '',
            allDay: !!allDay,
            isoStart: instStart.toISOString(),
            isoEnd: instEnd.toISOString(),
            src: 'ics',
            recurring: true
          })
        }
      }
    }
    if (rrule.freq === 'DAILY') cursor.setDate(cursor.getDate() + rrule.interval)
    else if (dayStep) cursor.setDate(cursor.getDate() + 1)
    else if (rrule.freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * rrule.interval)
    else if (rrule.freq === 'MONTHLY') cursor.setMonth(cursor.getMonth() + rrule.interval)
    else break
  }
  return occurrences
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
    const allDay = /^\d{8}$/.test(dtStart.replace(/Z$/, ''))
    const rrule = parseRrule(field('RRULE'))
    if (rrule.freq) {
      events.push(...expandRrule(startDate, endDate, rrule, weekStart, { uid, summary, location, allDay }))
      continue
    }
    const day = dayOfWeek(startDate, weekStart)
    if (day < 0 || day > 6) continue
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

export function buildIcsEvent(event) {
  const stamp = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  }
  const uid = String(event.id || `local-${Date.now()}`).replace(/^(ics-|caldav-|local-|gcal-|mcal-)/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//STELLARIS-7//COMMS//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.isoStart)}`,
    `DTEND:${stamp(event.isoEnd || event.isoStart)}`,
    `SUMMARY:${String(event.title || 'Untitled').replace(/\n/g, ' ')}`,
    event.location ? `LOCATION:${String(event.location).replace(/\n/g, ' ')}` : null,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n')
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
export function buildRfc822({ to, subject, body, attachments }) {
  const files = capAttachments(attachments)
  if (!files.length) {
    return [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      String(body || '')
    ].join('\r\n')
  }
  const boundary = `stellaris_${Date.now()}`
  const parts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    String(body || '')
  ]
  for (const a of files) {
    parts.push(`--${boundary}`)
    parts.push(`Content-Type: ${a.mime || 'application/octet-stream'}; name="${a.name}"`)
    parts.push('Content-Transfer-Encoding: base64')
    parts.push(`Content-Disposition: attachment; filename="${a.name}"`)
    parts.push('')
    parts.push(String(a.data || ''))
  }
  parts.push(`--${boundary}--`)
  return parts.join('\r\n')
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
async function fetchGoogleInbox() {
  const token = await refreshGoogle()
  const list = await gmailGet('/messages?maxResults=20&q=in:inbox OR in:sent', token)
  const ids = (list.messages || []).map((m) => m.id)
  const rows = []
  for (const id of ids) {
    const msg = await gmailGet(`/messages/${id}?format=full`, token)
    rows.push(mapGmailMessage(msg))
  }
  return rows
}

async function fetchMicrosoftInbox() {
  const token = await refreshMicrosoft()
  const json = await graphGet('/me/messages?$top=20&$select=id,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead,importance,hasAttachments', token)
  return (json.value || []).map(mapGraphMessage)
}

export async function fetchInbox(cfg = getConfig()) {
  const providers = cfg.emailProviders && cfg.emailProviders.length
    ? cfg.emailProviders
    : (cfg.emailProvider && cfg.emailProvider !== 'mixed' ? [cfg.emailProvider] : [])
  const rows = []
  for (const p of providers) {
    try {
      if (p === 'google') rows.push(...await fetchGoogleInbox())
      if (p === 'microsoft') rows.push(...await fetchMicrosoftInbox())
    } catch (err) {
      rows._errors = (rows._errors || []).concat(err.message)
    }
  }
  return rows
}

function caldavAuthHeaders() {
  const user = process.env.USER_CALDAV_USER || process.env.USER_ICS_USER
  if (!user) return {}
  const pass = process.env.USER_CALDAV_PASSWORD || process.env.USER_ICS_PASSWORD || ''
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }
}

function icsAuthHeaders() {
  if (!process.env.USER_ICS_USER) return {}
  const basic = Buffer.from(`${process.env.USER_ICS_USER}:${process.env.USER_ICS_PASSWORD || ''}`).toString('base64')
  return { Authorization: `Basic ${basic}` }
}

async function fetchGoogleEvents(ws, start, end) {
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

async function fetchMicrosoftEvents(ws, start, end) {
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

async function fetchIcsEvents(ws) {
  const url = process.env.USER_ICS_URL || process.env.USER_CALDAV_URL
  if (!url) return []
  const res = await fetch(url, { headers: process.env.USER_CALDAV_URL && !process.env.USER_ICS_URL ? caldavAuthHeaders() : icsAuthHeaders() })
  if (!res.ok) throw new Error(`ics ${res.status}`)
  return parseIcs(await res.text(), ws)
}

export async function fetchEvents(cfg = getConfig(), weekStart) {
  const { start, end, weekStart: ws } = weekBounds(weekStart)
  const providers = cfg.calendarProviders && cfg.calendarProviders.length
    ? cfg.calendarProviders
    : (cfg.calendarProvider && cfg.calendarProvider !== 'mixed' ? [cfg.calendarProvider] : [])
  const rows = []
  for (const p of providers) {
    try {
      if (p === 'google') rows.push(...await fetchGoogleEvents(ws, start, end))
      if (p === 'microsoft') rows.push(...await fetchMicrosoftEvents(ws, start, end))
      if (p === 'ics' || p === 'caldav') rows.push(...await fetchIcsEvents(ws))
    } catch (err) {
      rows._errors = (rows._errors || []).concat(err.message)
    }
  }
  const capped = rows.slice(0, EVENT_CAP)
  if (rows._errors) capped._errors = rows._errors
  return capped
}

/* ============================================================================
   MUTATIONS AGAINST PROVIDERS
   ============================================================================ */
export async function sendMail({ to, subject, body, attachments }, cfg = getConfig()) {
  if (!to || !subject) return { ok: false, error: 'to and subject required' }
  const files = capAttachments(attachments)
  const copy = localSentCopy({ to, subject, body, attachments: files })
  const provider = (cfg.emailProviders && cfg.emailProviders[0]) || cfg.emailProvider
  try {
    if (provider === 'google' || cfg.google) {
      const token = await refreshGoogle()
      const raw = toBase64Url(buildRfc822({ to, subject, body, attachments: files }))
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
    if (provider === 'microsoft' || cfg.microsoft) {
      const token = await refreshMicrosoft()
      const message = {
        subject,
        body: { contentType: 'Text', content: body || '' },
        toRecipients: [{ emailAddress: { address: to } }]
      }
      if (files.length) {
        message.attachments = files.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentType: a.mime,
          contentBytes: a.data || ''
        }))
      }
      const res = await fetch(`${MS_GRAPH}/me/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
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

function caldavHref(event) {
  const base = String(process.env.USER_CALDAV_URL || '').replace(/\/?$/, '/')
  const uid = String(event.id || `local-${Date.now()}`).replace(/^(ics-|caldav-|local-|gcal-|mcal-)/, '')
  return `${base}${uid}.ics`
}

export async function createRemoteEvent(event, cfg = getConfig()) {
  const providers = cfg.calendarProviders && cfg.calendarProviders.length
    ? cfg.calendarProviders
    : (cfg.calendarProvider && cfg.calendarProvider !== 'mixed' ? [cfg.calendarProvider] : [])
  try {
    if (providers.includes('google') || cfg.google) {
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
    if (providers.includes('microsoft') || cfg.microsoft) {
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
    if (cfg.caldav || providers.includes('caldav')) {
      const ics = buildIcsEvent(event)
      const href = caldavHref(event)
      const res = await fetch(href, {
        method: 'PUT',
        headers: { ...caldavAuthHeaders(), 'Content-Type': 'text/calendar; charset=utf-8' },
        body: ics
      })
      if (!res.ok) throw new Error(`caldav put ${res.status}`)
      return { ...event, id: `caldav-${String(event.id || '').replace(/^(ics-|caldav-|local-)/, '')}`, src: 'caldav' }
    }
  } catch (err) {
    return { ...event, src: 'local', error: err.message }
  }
  return { ...event, src: 'local', simulated: true }
}

export async function deleteRemoteEvent(id, cfg = getConfig()) {
  const raw = String(id || '')
  try {
    if (raw.startsWith('gcal-') && cfg.google) {
      const token = await refreshGoogle()
      const res = await fetch(`${GCAL_API}/events/${raw.slice(5)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok && res.status !== 404) throw new Error(`gcal delete ${res.status}`)
      return { ok: true, remote: true }
    }
    if (raw.startsWith('mcal-') && cfg.microsoft) {
      const token = await refreshMicrosoft()
      const res = await fetch(`${MS_GRAPH}/me/events/${raw.slice(5)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok && res.status !== 404) throw new Error(`graph delete ${res.status}`)
      return { ok: true, remote: true }
    }
    if ((raw.startsWith('caldav-') || raw.startsWith('ics-') || raw.startsWith('local-')) && cfg.caldav) {
      const href = caldavHref({ id: raw })
      const res = await fetch(href, { method: 'DELETE', headers: caldavAuthHeaders() })
      if (!res.ok && res.status !== 404) throw new Error(`caldav delete ${res.status}`)
      return { ok: true, remote: true }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true, remote: false }
}

export async function archiveRemote(id, cfg = getConfig()) {
  const raw = String(id || '')
  try {
    if (raw.startsWith('gm-') && cfg.google) {
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
    if (raw.startsWith('ms-') && cfg.microsoft) {
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
      if (rows && rows.length) out.email = rows.slice(0, MAIL_CAP)
      if (rows && rows._errors) out.errors.push(...rows._errors)
    } catch (err) {
      out.errors.push(err.message)
    }
  }
  if (cfg.calendarProvider) {
    try {
      const rows = await fetchEvents(cfg, weekStart)
      if (rows && rows.length) out.calendar = rows
      if (rows && rows._errors) out.errors.push(...rows._errors)
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
