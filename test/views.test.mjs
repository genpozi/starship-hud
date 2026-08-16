/**
 * VIEWS SUITE // Headless render of every HUD view body with zero JS errors.
 *
 * Runs each exported renderer against a minimal DOM shim (no browser, no
 * dependencies) and asserts the target container was populated. Guards the
 * renderers against template / escape / selector regressions — the same
 * surfaces the browser exercises live.
 */

// ---- minimal DOM shim ------------------------------------------------ //
const ELEMENT_CACHE = new Map()

class FakeClassList {
  constructor() {
    this.set = new Set()
  }
  add(...names) {
    names.forEach((n) => this.set.add(n))
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n))
  }
  toggle(name, force) {
    if (force === undefined) force = !this.set.has(name)
    if (force) this.set.add(name)
    else this.set.delete(name)
    return force
  }
  contains(name) {
    return this.set.has(name)
  }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag
    this.innerHTML = ''
    this.textContent = ''
    this.className = ''
    this.title = ''
    this.value = ''
    this.dataset = {}
    this.style = {}
    this.children = []
    this.classList = new FakeClassList()
    this.scrollTop = 0
    this.scrollHeight = 0
    this.clientHeight = 200
    this._onClick = null
  }
  get firstChild() {
    return this.children[0] || null
  }
  appendChild(child) {
    if (child && child._isFragment) this.children.push(...child.children)
    else this.children.push(child)
    return child
  }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    return child
  }
  querySelectorAll() {
    return []
  }
  addEventListener(type, fn) {
    if (type === 'click') this._onClick = fn
  }
}

function makeElement(sel) {
  if (!ELEMENT_CACHE.has(sel)) ELEMENT_CACHE.set(sel, new FakeElement())
  return ELEMENT_CACHE.get(sel)
}

function makeFragment() {
  const frag = new FakeElement('fragment')
  frag._isFragment = true
  return frag
}

globalThis.document = {
  querySelector: (sel) => makeElement(sel),
  createElement: (tag) => new FakeElement(tag),
  createDocumentFragment: () => makeFragment()
}

// ---- harness ---------------------------------------------------------- //
const { STATE } = await import('../src/store.js')
const views = await import('../src/views.js')

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const TARGETS = {
  renderKanban: '#kanban-board',
  renderItems: '#items-table',
  renderScheduler: '#cron-table',
  renderChat: '#chat-stream',
  renderDispatch: '#dispatch-console',
  renderApproval: '#approval-card',
  renderGraphs: '#graph-tokens',
  renderVault: '#vault-grid',
  renderEmail: '#email-list',
  renderCalendar: '#calendar-grid',
  renderAlerts: '#alert-feed',
  renderHealth: '#probe-grid',
  renderReports: '#reports-grid'
}

// ---- 1. every view renderer populates its container, no throw --------- //
let errors = 0
for (const [fn, sel] of Object.entries(TARGETS)) {
  try {
    if (fn === 'renderGraphs') views[fn](STATE.telemetry)
    else if (fn === 'renderHealth') views[fn](STATE.logs)
    else views[fn]()
    const el = makeElement(sel)
    const populated =
      (typeof el.innerHTML === 'string' && el.innerHTML.length > 0) ||
      el.children.length > 0 ||
      (fn === 'renderApproval' && el.classList.contains('hidden'))
    pass(`${fn} renders without throwing`, populated)
  } catch (err) {
    errors += 1
    pass(`${fn} renders without throwing`, false)
    console.error(`  [${fn}] threw:`, err.message)
  }
}

// ---- 2. chat + log stream renderers append rows incrementally --------- //
const box = new FakeElement('div')
const renderChat = views.createStreamRenderer((m) => m.text, (m) => new FakeElement('div'), 60)
renderChat(box, [{ text: 'a' }, { text: 'b' }])
renderChat(box, [{ text: 'a' }, { text: 'b' }, { text: 'c' }])
pass('stream renderer appends only new rows', box.children.length === 3)

// ---- 3. escapeHtml stays bulletproof ---------------------------------- //
pass('escapeHtml null-safe', views.escapeHtml(null) === '')
pass('escapeHtml escapes angle brackets', views.escapeHtml('<script>alert(1)</script>').includes('&lt;'))
pass('escapeHtml escapes quotes', views.escapeHtml(`"onerror='x'`) === '&quot;onerror=&#39;x&#39;')

// ---- 4. every STATE slice referenced by the 12 views is seeded --------- //
const REQUIRED = ['agents', 'workflows', 'kanban', 'items', 'schedules', 'chat', 'dispatch', 'vault', 'email', 'calendar', 'alerts', 'probes', 'reports', 'telemetry', 'approval', 'logs']
for (const k of REQUIRED) pass(`STATE.${k} seeded`, STATE[k] !== undefined && STATE[k] !== null)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length || errors ? `\n${fails.length + errors} FAILURES` : '\nALL PASS')
process.exit(fails.length || errors ? 1 : 0)
