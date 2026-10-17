/* ==========================================================================
   手机版自检夹具（开发用）
   —— 迷你 DOM + Supabase 桩，在 Node 里真实执行 phone.js / login.html 的内联脚本
   —— 用于抓语法错误、空引用、渲染异常，并输出渲染后的 HTML 结构做人工核对
   用法： node --experimental-vm-modules tests/dom-harness.js
   （无需实验开关，普通 node 即可）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PHONE = path.resolve(__dirname, '..');
const problems = [];
const notes = [];

/* ------------------------------------------------------------------ 迷你 DOM */
let idSeq = 0;

function matches(el, selector) {
  return matchSimple(el, selector);
}

function matchesAny(el, selector) {
  // 只支持简单选择器（tag / .class / #id / [attr] / tag.class）
  return matchSimple(el, String(selector).trim().split(/\s+/).pop());
}

function matchSimple(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const own = el.attributes || {};
  let ok = true;

  // [attr] / [attr="value"]
  const attrMatches = String(sel).match(/\[[^\]]*\]/g) || [];
  attrMatches.forEach(a => {
    const m = a.match(/\[([^\]=]+)(?:=("?)([^"\]]*)\2)?\]/);
    if (!m) return;
    const name = m[1];
    const value = m[3];
    if (!(name in own)) { ok = false; return; }
    if (value !== undefined && String(own[name]) !== value) ok = false;
  });

  const bare = String(sel).replace(/\[[^\]]*\]/g, '').replace(/::?[a-z-]+(\([^)]*\))?/g, '');
  if (bare.startsWith('.')) {
    if (!String(own.class || '').split(/\s+/).includes(bare.slice(1))) ok = false;
  } else if (bare.startsWith('#')) {
    if (own.id !== bare.slice(1)) ok = false;
  } else if (bare) {
    if (el.tagName.toLowerCase() !== bare.toLowerCase()) ok = false;
  }
  return ok;
}

function classList(el) {
  const read = () => String(el.attributes.class || '').split(/\s+/).filter(Boolean);
  const write = list => { el.attributes.class = list.join(' '); };
  return {
    add(...names) { const l = read(); names.forEach(n => { if (!l.includes(n)) l.push(n); }); write(l); },
    remove(...names) { write(read().filter(n => !names.includes(n))); },
    toggle(name, force) {
      const has = read().includes(name);
      const want = force === undefined ? !has : !!force;
      if (want) this.add(name); else this.remove(name);
      return want;
    },
    contains(name) { return read().includes(name); },
  };
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag || 'div').toUpperCase();
    this.attributes = {};
    this.children = [];
    this._handlers = {};
    this._html = '';
    this.value = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
    };
    this._uid = ++idSeq;
  }

  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = String(v); }
  get className() { return this.attributes.class || ''; }
  set className(v) { this.attributes.class = String(v); }
  get href() { return this.attributes.href || ''; }
  set href(v) { this.attributes.href = String(v); }
  get checked() { return this.attributes.checked === true; }
  set checked(v) { this.attributes.checked = !!v; }
  get disabled() { return this.attributes.disabled === true; }
  set disabled(v) { this.attributes.disabled = !!v; }
  get hidden() { return this.attributes.hidden === true; }
  set hidden(v) { this.attributes.hidden = !!v; }
  get dataset() {
    if (!this._dataset) {
      this._dataset = new Proxy({}, {
        get: (t, k) => this.attributes['data-' + String(k).replace(/[A-Z]/g, m => '-' + m.toLowerCase())],
        set: (t, k, v) => { this.attributes['data-' + String(k)] = String(v); return true; },
      });
    }
    return this._dataset;
  }

  get classList() { return classList(this); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get outerHTML() { return '<' + this.tagName.toLowerCase() + '>' + this._html; }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const parts = String(sel).trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const ancestors = parts.slice(0, -1);
    const out = [];
    const walk = node => {
      if (matchSimple(node, last)) {
        let n = node.parentNode;
        let ok = ancestors.length === 0;
        for (let i = ancestors.length - 1; i >= 0 && n; i--) {
          if (matchSimple(n, ancestors[i])) { ok = true; break; }
          n = n.parentNode;
        }
        if (ok) out.push(node);
      }
      node.children.forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }

  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._handlers[type];
    if (l) this._handlers[type] = l.filter(x => x !== fn);
  }
  dispatch(type, event) {
    const ev = Object.assign({
      type, target: this, currentTarget: this,
      preventDefault() {}, stopPropagation() { ev._stopped = true; },
      closest: sel => (matchesAny(this, sel) ? this : null),
    }, event || {});
    if (process.env.HARNESS_TRACE === '1') {
      console.log('[trace] dispatch ' + type + ' on <' + this.tagName.toLowerCase() + '> handlers=' + (this._handlers[type] || []).length);
    }
    // 模拟冒泡：从自身往上逐层触发监听器
    let node = this;
    while (node) {
      const list = node._handlers && node._handlers[type];
      if (list) {
        ev.currentTarget = node;
        list.slice().forEach(fn => {
          try { fn.call(node, ev); } catch (e) { problems.push('handler ' + type + ' on ' + node.tagName + ': ' + e.message); }
        });
      }
      if (ev._stopped) break;
      node = node.parentNode;
    }
    return ev;
  }
  click() { this.dispatch('click'); }
  focus() { this.dispatch('focus'); }
  blur() { this.dispatch('blur'); }
  select() {}
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  insertAdjacentHTML(pos, html) {
    const frag = parseFragment(String(html));
    if (pos === 'afterbegin') this.children.unshift(...frag);
    else this.children.push(...frag);
    frag.forEach(n => { n.parentNode = this; });
    if (pos === 'beforeend' || pos === undefined) this._html += String(html);
  }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 400, height: 60, right: 400, bottom: 60 }; }
  getAttribute(n) { return this.attributes[n] === undefined ? null : this.attributes[n]; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  closest(sel) { let n = this; while (n) { if (matchesAny(n, sel)) return n; n = n.parentNode; } return null; }
}

/* 从 HTML 源码构建元素树（只识别 id / class / data-* / 标签名，够用） */
/* 从 HTML 片段构建元素数组（用于 innerHTML / insertAdjacentHTML） */
function parseFragment(html) {
  const holder = new FakeElement('div');
  const nodes = parseInto(holder, String(html));
  return nodes;
}

function parseHtml(html) {
  const root = new FakeElement('body');
  parseInto(root, String(html));
  return root;
}

function parseInto(root, html) {
  const created = [];
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'area', 'base', 'col']);

  let m;
  let lastIndex = 0;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(lastIndex, m.index);
    if (text.trim() && stack.length) stack[stack.length - 1]._html += text;
    lastIndex = tagRe.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
      }
      continue;
    }

    if (tag === 'script' || tag === 'style') {
      const close = html.indexOf('</' + tag, lastIndex);
      lastIndex = close === -1 ? html.length : close;
      tagRe.lastIndex = lastIndex;
      continue;
    }

    const el = new FakeElement(tag);
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = attrRe.exec(attrs))) {
      let value = a[2] === undefined ? '' : a[2];
      value = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      el.attributes[a[1]] = value;
    }
    stack[stack.length - 1].appendChild(el);
    if (stack.length === 1) created.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return created;
}

/* ------------------------------------------------------------------ Supabase 桩 */
function createSupabaseStub(fixtures, log) {
  const now = Date.now();
  const ROWS = {
    profiles: fixtures.profiles || [],
    channels: fixtures.channels || [],
    friends: fixtures.friends || [],
    messages: fixtures.messages || [],
    user_devices: fixtures.devices || [],
    channel_read_state: [],
  };

  function builder(table) {
    const b = {
      _filters: [], _op: 'select', _payload: null, _limit: null, _order: null, _asc: true, _head: false, _single: null,
    };
    const chain = {
      select() { return chain; },
      insert(rows) { b._op = 'insert'; b._payload = [].concat(rows); return chain; },
      upsert(rows) { b._op = 'upsert'; b._payload = [].concat(rows); return chain; },
      update(p) { b._op = 'update'; b._payload = p; return chain; },
      delete() { b._op = 'delete'; return chain; },
      eq(c, v) { b._filters.push({ c, op: 'eq', v }); return chain; },
      neq(c, v) { b._filters.push({ c, op: 'neq', v }); return chain; },
      gt(c, v) { b._filters.push({ c, op: 'gt', v }); return chain; },
      in(c, arr) { b._filters.push({ c, op: 'in', v: arr }); return chain; },
      or() { return chain; },
      not() { return chain; },
      limit(n) { b._limit = n; return chain; },
      order(c, o) { b._order = c; b._asc = !(o && o.ascending === false); return chain; },
      single() { b._single = 'single'; return chain; },
      maybeSingle() { b._single = 'maybe'; return chain; },
      then(resolve) {
        try {
          const out = run(b, table, ROWS, now, log);
          resolve(out);
        } catch (e) {
          problems.push('supabase.' + table + ': ' + e.message);
          resolve({ data: null, error: { message: e.message } });
        }
      },
    };
    return chain;
  }

  const client = {
    from: table => builder(table),
    rpc: (name, args) => {
      log.push('rpc ' + name + ' ' + JSON.stringify(args));
      if (name === 'get_or_create_private_chat') return Promise.resolve({ data: 'chan-priv-2', error: null });
      if (name === 'create_group') return Promise.resolve({ data: 'chan-group-9', error: null });
      return Promise.resolve({ data: null, error: null });
    },
    channel: () => {
      const ch = { on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; } };
      return ch;
    },
  };
  return client;
}

function run(b, table, ROWS, now, log) {
  const rows = (ROWS[table] || []).slice();
  const filtered = rows.filter(r => b._filters.every(f => {
    const v = r[f.c];
    if (f.op === 'eq') return String(v) === String(f.v);
    if (f.op === 'neq') return String(v) !== String(f.v);
    if (f.op === 'gt') return new Date(v) > new Date(f.v);
    if (f.op === 'in') return f.v.map(String).includes(String(v));
    return true;
  }));

  if (b._op === 'insert' || b._op === 'upsert') {
    (b._payload || []).forEach(p => {
      const rec = Object.assign({ id: 'gen-' + (ROWS[table] || []).length, created_at: new Date(now).toISOString() }, p);
      (ROWS[table] = ROWS[table] || []).push(rec);
    });
    log.push(table + '.' + b._op + ' x' + (b._payload || []).length);
    const first = (ROWS[table] || [])[(ROWS[table] || []).length - 1];
    return { data: b._single ? first : (b._payload || []), error: null };
  }
  if (b._op === 'delete') {
    ROWS[table] = (ROWS[table] || []).filter(r => !b._filters.every(f => String(r[f.c]) === String(f.v)));
    log.push(table + '.delete');
    return { data: null, error: null };
  }
  if (b._op === 'update') {
    filtered.forEach(r => Object.assign(r, b._payload));
    return { data: filtered, error: null };
  }

  let out = filtered;
  if (b._order) {
    out = out.slice().sort((x, y) => {
      let a = x[b._order], c = y[b._order];
      if (String(b._order).includes('_at')) { a = new Date(a); c = new Date(c); }
      return (a > c ? 1 : a < c ? -1 : 0) * (b._asc ? 1 : -1);
    });
  }
  if (b._limit) out = out.slice(0, b._limit);
  log.push(table + '.select' + (b._filters.length ? ' [' + b._filters.map(f => f.c + f.op).join(',') + ']' : '') + ' -> ' + out.length);
  if (b._single) return { data: out[0] || null, error: null };
  return { data: out, error: null };
}

/* ------------------------------------------------------------------ 环境搭建 */
function createEnv(html, url, fixtures, opts) {
  const log = [];
  const root = parseHtml(html);
  const byId = new Map();
  (function collect(node) {
    if (node.attributes && node.attributes.id) byId.set(node.attributes.id, node);
    node.children.forEach(collect);
  })(root);
  if (opts && opts.echoIds) {
    console.log('[debug] 解析到 id 数量:', byId.size, '| 有 chatView:', byId.has('chatView'), '| 有 app:', byId.has('app'));
  }

  const document = {
    nodeType: 9,
    documentElement: new FakeElement('html'),
    body: root,
    readyState: 'complete',
    visibilityState: 'visible',
    _handlers: {},
    getElementById: id => byId.get(id) || null,
    querySelector: sel => root.querySelector(sel),
    querySelectorAll: sel => root.querySelectorAll(sel),
    createElement: tag => new FakeElement(tag),
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this._handlers[type] || []).forEach(fn => fn(ev || { type })); },
    cookie: opts.cookie || '',
  };
  document.documentElement.attributes = { 'data-theme': 'light' };

  const storage = (initial) => {
    const map = new Map(Object.entries(initial || {}));
    return {
      get length() { return map.size; },
      key: i => Array.from(map.keys())[i],
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: k => { map.delete(k); },
      clear: () => map.clear(),
      _map: map,
    };
  };

  const localStorage = storage(opts.localStorage);
  const sessionStorage = storage(opts.sessionStorage);

  const sandbox = {
    console: { log: (...a) => log.push('log ' + a.join(' ')), warn: (...a) => log.push('warn ' + a.join(' ')), error: (...a) => log.push('err ' + a.join(' ')) },
    document,
    localStorage,
    sessionStorage,
    location: {
      href: url, search: url.includes('?') ? url.slice(url.indexOf('?')) : '',
      pathname: url.split('?')[0], replace(u) { log.push('location.replace ' + u); }, assign(u) { log.push('location.assign ' + u); },
    },
    navigator: { userAgent: 'node-harness', maxTouchPoints: 1, clipboard: null, mediaDevices: null },
    history: { state: null, pushState(s) { this.state = s; log.push('pushState ' + JSON.stringify(s)); }, replaceState(s) { this.state = s; }, back() { log.push('history.back'); } },
    screen: { width: 390, height: 844 },
    innerWidth: 390, innerHeight: 844,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} }),
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
    fetch: (u, o) => {
      log.push('fetch ' + String(u).slice(0, 90));
      if (String(u).includes('supabase.co')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      if (String(u).includes('airtable')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ records: fixtures.airtable || [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, records: [] }) });
    },
    Notification: undefined,
    Event: function (t) { return { type: t }; },
    URLSearchParams: URLSearchParams,
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, isNaN, parseInt, parseFloat,
    prompt: (msg) => (opts.promptAnswer || '测试群'),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = (type, fn) => document.addEventListener(type, fn);
  sandbox.supabase = { createClient: () => createSupabaseStub(fixtures, log) };

  return { sandbox, document, root, byId, log, localStorage, sessionStorage };
}

function extractScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* ------------------------------------------------------------------ 用例 */
const FIXTURES = {
  profiles: [
    { id: 'u10000', nickname: '梓睿' },
    { id: 'u10001', nickname: '谭秀娟' },
    { id: 'u10006', nickname: '兰' },
  ],
  channels: [
    { id: '11111111-1111-1111-1111-111111111111', name: '公共聊天', type: 'public', user_id: 'u10000', slot: 1 },
    { id: 'chan-priv-1', name: null, type: 'private', user_id: 'u10000', slot: 1 },
    { id: 'chan-priv-1', name: null, type: 'private', user_id: 'u10006', slot: 2 },
    { id: 'chan-group-1', name: '周末出游群', type: 'group', user_id: 'u10000', slot: 1 },
  ],
  friends: [{ user_id: 'u10000', friend_id: 'u10001' }],
  messages: [
    { id: 'm1', channel_id: '11111111-1111-1111-1111-111111111111', user_id: 'u10001', content: '大家早上好呀 ☀️', created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: 'm2', channel_id: '11111111-1111-1111-1111-111111111111', user_id: 'u10000', content: '早！今天也要加油 💪', created_at: new Date(Date.now() - 3500000).toISOString() },
    { id: 'm3', channel_id: 'chan-priv-1', user_id: 'u10006', content: '晚上一起吃饭吗？', created_at: new Date(Date.now() - 600000).toISOString() },
    { id: 'm4', channel_id: 'chan-group-1', user_id: 'u10001', content: '周末的行程我发群里了', created_at: new Date(Date.now() - 300000).toISOString() },
  ],
  devices: [
    { user_id: 'u10000', device_id: 'h5-abc', device_name: 'Chrome / Android', last_active_at: new Date().toISOString() },
    { user_id: 'u10000', device_id: 'dev-mac', device_name: 'Safari / macOS', last_active_at: new Date(Date.now() - 86400000).toISOString() },
  ],
  airtable: [
    { id: 'rec1', fields: { '标题': '更新公告', '小标题': '手机版上线', '发布者': '系统服务', '发布时间': new Date().toISOString() } },
  ],
};

const LOGGED_IN_COOKIE = 'userId=u10000; displayName=%E6%A2%93%E7%9D%BF; userEmail=zirui%40example.com; role=user; isLoggedIn=true';
const SESSION = {
  userId: 'u10000', displayName: '梓睿', userEmail: 'zirui@example.com', role: 'user',
  user_data: JSON.stringify({ id: 'u10000', username: '梓睿', email: 'zirui@example.com', role: 'user' }),
  deviceId: 'h5-abc',
};

function runPage(file, url, opts) {
  const html = fs.readFileSync(path.join(PHONE, file), 'utf8');
  const env = createEnv(html, url, FIXTURES, Object.assign({
    cookie: LOGGED_IN_COOKIE,
    localStorage: { chat_settings: JSON.stringify({ theme: 'light', fontSize: 'normal', bubbleDensity: 'standard', showPreview: true, showBadge: true, autoDownloadImage: true }) },
    sessionStorage: SESSION,
  }, opts || {}));

  // 模拟浏览器：HTML 已解析完（DOM 就绪）→ 依次执行内联脚本 → 触发 DOMContentLoaded
  env.document.readyState = 'loading';
  const context = vm.createContext(env.sandbox);
  const srcScripts = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))
    .filter(mm => !/\ssrc=/.test(mm[1]))
    .map(mm => mm[2]);
  const inlineScripts = srcScripts.filter(code => !code.includes('phone.js'));
  env.log.push('inline scripts: ' + inlineScripts.length + ' (src scripts: ' + srcScripts.length + ')');
  inlineScripts.forEach((code, i) => {
    try {
      new vm.Script(code, { filename: file + '#inline' + (i + 1) }).runInContext(context);
      env.log.push('inline' + (i + 1) + ' ok, length=' + code.length);
    } catch (e) {
      problems.push(file + ' inline' + (i + 1) + ': ' + e.message);
      env.log.push('inline' + (i + 1) + ' FAILED: ' + e.message);
    }
  });

  // 外链脚本
  if (html.includes('phone.js')) {
    const code = fs.readFileSync(path.join(PHONE, 'phone.js'), 'utf8');
    try {
      new vm.Script(code, { filename: 'phone.js' }).runInContext(context);
      env.log.push('phone.js ok');
    } catch (e) {
      problems.push(file + ' phone.js: ' + e.message);
      env.log.push('phone.js FAILED: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
    }
  }
  env.document.readyState = 'complete';
  try {
    env.document.dispatch('DOMContentLoaded', { type: 'DOMContentLoaded' });
  } catch (e) {
    problems.push(file + ' DOMContentLoaded: ' + e.message);
  }

  // 跑 microtask 队列，等待异步渲染完成
  return new Promise(resolve => {
    setTimeout(() => resolve(env), 120);
  });
}

async function testChatPage() {
  const env = await runPage('chat.html', 'https://example.com/phone/chat.html', {});
  if (process.env.HARNESS_VERBOSE === '1') {
    console.log('[verbose] 页面日志:');
    env.log.slice(0, 40).forEach(l => console.log('   ' + l));
    console.log('[verbose] 已记录问题:', problems.length);
    problems.forEach(p => console.log('   ✗ ' + p));
  }
  const list = env.byId.get('list');
  const html = list ? list.innerHTML : '';
  notes.push('chat.html 会话列表条目数: ' + (html.match(/class="list-item"/g) || []).length);
  notes.push('chat.html 列表含公共聊天: ' + html.includes('公共聊天'));
  notes.push('chat.html 列表含兰(私聊昵称): ' + html.includes('兰'));
  notes.push('chat.html 列表含群名: ' + html.includes('周末出游群'));
  notes.push('chat.html 预览含最后消息: ' + html.includes('周末的行程我发群里了'));

  if (!html.includes('公共聊天')) problems.push('会话列表未渲染出公共聊天');
  if (!html.includes('周末出游群')) problems.push('会话列表未渲染出群聊');
  if (!html.includes('兰')) problems.push('私聊未取到对方昵称');

  // 点击第一个会话（公共聊天）→ 打开聊天页并渲染消息
  const items = list ? list.querySelectorAll('.list-item') : [];
  const docItems = env.document.querySelectorAll('.list-item');
  const anyItems = env.document.querySelectorAll('.item-inner');
  notes.push('chat.html 夹具查到 .list-item=' + items.length + ' 文档级=' + docItems.length + ' .item-inner=' + anyItems.length +
    ' 子元素=' + (list ? list.children.length : -1));
  const target = (docItems.length ? docItems : items)
    .find(el => el.attributes['data-id'] === '11111111-1111-1111-1111-111111111111');
  if (!target) {
    notes.push('chat.html 列表子元素标签: ' + (list ? list.children.map(c => c.tagName + '.' + (c.attributes.class || '')).join(' | ') : ''));
    problems.push('未找到公共聊天列表项');
  } else {
    const inner = target.querySelector('.item-inner') || target;
    inner.dispatch('click');
    await new Promise(r => setTimeout(r, 80));
    const messages = env.byId.get('messages');
    const msgHtml = messages ? messages.innerHTML : '';
    notes.push('chat.html 打开会话后消息区含消息: ' + (msgHtml.includes('大家早上好呀')));
    notes.push('chat.html 自己的气泡 self: ' + msgHtml.includes('msg self'));
    const view = env.byId.get('chatView');
    notes.push('chat.html 聊天页已滑入: ' + view.classList.contains('open'));
    notes.push('chat.html 标题: ' + (env.byId.get('chatTitle') || {}).textContent);
    if (!msgHtml.includes('大家早上好呀')) problems.push('打开会话后未渲染消息');
    if (!view.classList.contains('open')) problems.push('打开会话后聊天页未滑入');
  }

  // 标签切换
  const tabItems = env.document.querySelectorAll('.tab-item');
  env.log.push('tab-item 命中: ' + tabItems.length + ' tabs=' + tabItems.map(t => t.attributes['data-tab']).join(','));
  tabItems.forEach(t => { if (t.attributes['data-tab'] === 'me') t.dispatch('click'); });
  await new Promise(r => setTimeout(r, 40));
  const meActive = env.document.querySelectorAll('.tab-pane').some(p => p.attributes['data-pane'] === 'me' && p.classList.contains('active'));
  notes.push('chat.html 「我」标签可切换: ' + meActive);
  if (!meActive) {
    problems.push('「我」标签切换失败');
    env.log.forEach(l => notes.push('   [log] ' + l));
  }

  // 设置页打开
  const setCell = env.byId.get('meAvatar');
  env.document.querySelectorAll('#paneMe [data-act]').forEach(c => { if (c.attributes['data-act'] === 'settings') c.dispatch('click'); });
  await new Promise(r => setTimeout(r, 60));
  const settingsView = env.byId.get('settingsView');
  notes.push('chat.html 设置页可打开: ' + settingsView.classList.contains('open'));
  notes.push('chat.html 设置页昵称回填: ' + (env.byId.get('stNickname') || {}).value);
  if (!settingsView.classList.contains('open')) problems.push('设置页未能打开');

  notes.push('chat.html 数据请求日志:');
  env.log.filter(l => /select|insert|upsert|delete|rpc/.test(l)).slice(0, 12).forEach(l => notes.push('   ' + l));
}

async function testHomePage() {
  const env = await runPage('index.html', 'https://example.com/phone/index.html', {
    localStorage: {
      chat_settings: JSON.stringify({ theme: 'dark', showBadge: true }),
      chat_conversations: JSON.stringify([
        { id: 'chan-group-1', name: '周末出游群', type: 'group', last_time: new Date().toISOString(), unread: 2 },
        { id: '11111111-1111-1111-1111-111111111111', name: '公共聊天', type: 'public', last_time: new Date().toISOString(), unread: 0 },
      ]),
    },
  });
  const app = env.byId.get('app');
  notes.push('index.html 主界面可见: ' + (app && app.style.display === 'flex'));
  const recent = env.byId.get('recentList');
  const html = recent ? recent.innerHTML : '';
  notes.push('index.html 最近会话渲染: ' + (html.includes('周末出游群') && html.includes('公共聊天')));
  notes.push('index.html 未读徽标: ' + html.includes('badge-inline'));
  notes.push('index.html 深色模式生效: ' + (env.document.documentElement.attributes['data-theme'] === 'dark'));
  if (!html.includes('周末出游群')) problems.push('首页最近会话未渲染');
  if (env.document.documentElement.attributes['data-theme'] !== 'dark') problems.push('首页深色模式未生效');
}

async function testLoginPage() {
  const env = await runPage('login.html', 'https://example.com/phone/login.html', {
    cookie: '',
    sessionStorage: {},
  });
  notes.push('login.html 无会话时隐藏「直接进入」: ' + (env.byId.get('existingSession').style.display !== 'block'));

  const env2 = await runPage('login.html', 'https://example.com/phone/login.html', {});
  notes.push('login.html 有会话时显示「直接进入」: ' + (env2.byId.get('existingSession').style.display === 'block'));
  notes.push('login.html 本机账号名: ' + env2.byId.get('existingName').textContent);

  // 提交登录表单
  env2.byId.get('loginAccount').value = 'zirui';
  env2.byId.get('loginPassword').value = 'secret123';
  env2.byId.get('loginForm').dispatch('submit');
  await new Promise(r => setTimeout(r, 60));
  notes.push('login.html 提交后提示: ' + env2.byId.get('msg').textContent);
}

async function main() {
  await testChatPage();
  await testHomePage();
  await testLoginPage();

  console.log('===== 自检结果 =====');
  notes.forEach(n => console.log(n));
  console.log('');
  if (problems.length) {
    console.log('发现 ' + problems.length + ' 个问题：');
    problems.forEach(p => console.log('  ✗ ' + p));
    process.exitCode = 1;
  } else {
    console.log('✅ 未发现问题（phone.js 在迷你 DOM 中完整执行通过）');
  }
}

main().catch(e => {
  console.error('夹具自身异常：', e);
  process.exitCode = 2;
});
