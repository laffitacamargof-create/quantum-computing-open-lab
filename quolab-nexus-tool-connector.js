/* QuOLab Nexus Tool Connector — non-invasive telemetry bridge v1 */
(function (global) {
  'use strict';
  if (global.QuOLabNexusToolConnector) return;

  const VERSION = '1.0.0';
  const TOOL_BY_FILE = {
    'quolab-nexus-projects.html': 'projects',
    'quolab-nexus-architect.html': 'architect',
    'quolab-nexus-quantum-notebook.html': 'architect-pro',
    'quolab-nexus-library.html': 'library',
    'quolab-nexus-help.html': 'help',
    'quolab-nexus-quantum-puzzle.html': 'quantum-puzzle'
  };
  const tool = TOOL_BY_FILE[global.location.pathname.split('/').pop()] || 'unknown';
  const SENSITIVE = /password|passphrase|secret|token|api.?key|private.?key|credential|founder|authorization|cookie|session/i;
  const MAX_TEXT = 1200;

  function sanitize(value, key, depth) {
    if (SENSITIVE.test(String(key || ''))) return '[REDACTED]';
    if (depth > 4) return '[DEPTH_LIMIT]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (depth < 4 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try { return sanitize(JSON.parse(trimmed), '', depth + 1); } catch (_) {}
      }
      return value
        .replace(/(?:sb_secret_|sk-|ghp_|github_pat_)[A-Za-z0-9_\\-]{8,}/g, '[REDACTED]')
        .replace(/(Bearer\\s+)[A-Za-z0-9._\\-]+/gi, '$1[REDACTED]')
        .replace(/((?:password|passwd|token|api[_-]?key|secret|authorization)=)[^&\\s]+/gi, '$1[REDACTED]')
        .slice(0, MAX_TEXT);
    }
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, '', depth + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).slice(0, 35).forEach(k => { out[k] = sanitize(value[k], k, depth + 1); });
      return out;
    }
    return String(value).slice(0, 100);
  }

  function safeUrl(raw) {
    try {
      const url = new URL(String(raw || ''), global.location.href);
      const queryKeys = Array.from(url.searchParams.keys());
      const safeQuery = queryKeys.length ? '?' + queryKeys.map(key => encodeURIComponent(key) + '=[REDACTED]').join('&') : '';
      return (url.origin === global.location.origin ? url.pathname : url.origin + url.pathname) + safeQuery;
    } catch (_) { return String(raw || '').slice(0, 240); }
  }

  function send(kind, details) {
    if (!global.parent || global.parent === global) return;
    try {
      global.parent.postMessage({
        type: 'NEXUS_TOOL_EVENT',
        tool,
        version: VERSION,
        kind,
        details: sanitize(details || {}, '', 0),
        timestamp: Date.now()
      }, global.location.origin);
    } catch (_) {}
  }

  function fieldLabel(el) {
    const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
    return String(label || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 100);
  }

  function inspect() {
    const inputs = Array.from(global.document.querySelectorAll('input,textarea,select,[contenteditable="true"]'))
      .filter(el => el.type !== 'hidden' && !el.disabled && el.getClientRects().length)
      .slice(0, 60)
      .map(el => {
        const meta = { id: el.id || '', name: el.getAttribute('name') || '', type: el.type || el.tagName.toLowerCase(), label: fieldLabel(el) };
        meta.value = SENSITIVE.test([meta.id, meta.name, meta.type, meta.label].join(' ')) || el.type === 'password'
          ? '[REDACTED]' : sanitize(el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : (el.value || el.innerText || ''), '', 0);
        return meta;
      });
    const outputs = Array.from(global.document.querySelectorAll('pre,output,[aria-live="polite"],[aria-live="assertive"],[id*="output" i],[class*="output" i],[id*="result" i],[class*="result" i]'))
      .slice(0, 25).map(el => sanitize(el.innerText || el.textContent || '', '', 0)).filter(Boolean);
    return { tool, title: global.document.title, url: safeUrl(global.location.href), inputs, outputs };
  }

  global.document.addEventListener('input', event => {
    const el = event.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.type === 'password') return;
    const meta = { id: el.id || '', name: el.getAttribute('name') || '', type: el.type || el.tagName.toLowerCase(), label: fieldLabel(el) };
    meta.value = SENSITIVE.test([meta.id, meta.name, meta.type, meta.label].join(' ')) ? '[REDACTED]' : sanitize(el.value, '', 0);
    send('input', meta);
  }, true);

  global.document.addEventListener('click', event => {
    const el = event.target && event.target.closest ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
    if (!el) return;
    send('click', { tag: el.tagName.toLowerCase(), id: el.id || '', text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 120) });
  }, true);

  if (typeof global.fetch === 'function') {
    const originalFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const body = init && init.body;
      send('request', { method, url: safeUrl(url), body: typeof body === 'string' ? sanitize(body, '', 0) : body ? '[NON_TEXT_BODY]' : '' });
      return originalFetch(input, init).then(response => {
        try {
          const copy = response.clone();
          copy.text().then(text => {
            let payload = text;
            try { payload = JSON.parse(text); } catch (_) {}
            send('response', { method, url: safeUrl(url), status: response.status, ok: response.ok, body: sanitize(payload, '', 0) });
          }).catch(() => {});
        } catch (_) {}
        return response;
      }, error => {
        send('network_error', { method, url: safeUrl(url), message: error && error.message || 'Request failed' });
        throw error;
      });
    };
  }

  try {
    const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
    if (proto && !proto.__quolabNexusWrapped) {
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function (method, url) {
        this.__quolabNexusMeta = { method: String(method || 'GET').toUpperCase(), url: safeUrl(url) };
        return originalOpen.apply(this, arguments);
      };
      proto.send = function (body) {
        const meta = this.__quolabNexusMeta || { method: 'GET', url: '' };
        send('request', { method: meta.method, url: meta.url, body: typeof body === 'string' ? sanitize(body, '', 0) : body ? '[NON_TEXT_BODY]' : '' });
        this.addEventListener('load', function () {
          let payload = '';
          try { payload = this.responseType === 'json' ? this.response : (this.responseText || ''); } catch (_) {}
          try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch (_) {}
          send('response', { method: meta.method, url: meta.url, status: this.status, body: sanitize(payload, '', 0) });
        }, { once: true });
        this.addEventListener('error', function () { send('network_error', { method: meta.method, url: meta.url, message: 'XMLHttpRequest failed' }); }, { once: true });
        return originalSend.apply(this, arguments);
      };
      proto.__quolabNexusWrapped = true;
    }
  } catch (_) {}

  global.addEventListener('error', event => {
    send('runtime_error', { message: event.message || 'Runtime error', file: safeUrl(event.filename || ''), line: event.lineno || 0 });
  });
  global.addEventListener('unhandledrejection', event => {
    send('runtime_error', { message: event.reason && event.reason.message || String(event.reason || 'Unhandled rejection') });
  });

  global.QuOLabNexusToolConnector = Object.freeze({
    version: VERSION,
    tool,
    inspect,
    report: (kind, details) => send(String(kind || 'custom').slice(0, 50), details)
  });
  send('ready', { version: VERSION, title: global.document.title });
})(window);
