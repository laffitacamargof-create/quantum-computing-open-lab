/* QuOLab Nexus Tool Connector — sanitized telemetry bridge v1.9.0 */
(function (global) {
  'use strict';
  if (global.QuOLabNexusToolConnector) return;

  const VERSION = '1.9.0';
  const TOOL_BY_FILE = {
    'quolab-nexus-projects.html': 'projects',
    'quolab-nexus-architect.html': 'architect',
    'quolab-nexus-quantum-notebook.html': 'architect-pro',
    'quolab-nexus-connectors.html': 'nexus-connectors',
    'quolab-nexus-help.html': 'help',
    'quolab-nexus-quantum-puzzle.html': 'quantum-puzzle',
    'quolab-nexus-app-studio.html': 'quantum-app-studio'
  };
  const tool = global.__QUOLAB_NEXUS_TOOL || TOOL_BY_FILE[global.location.pathname.split('/').pop()] || 'unknown';
  const SENSITIVE = /password|passphrase|secret|token|api.?key|private.?key|credential|founder|authorization|cookie|session/i;
  const MAX_TEXT = 1200;
  const SAFE_RESPONSE_PATHS = new Set(['/health','/health/predict','/run','/run/predict']);
  function contextEnabled() {
    try { return global.localStorage.getItem('openq_ai_ctx') !== '0'; }
    catch (_) { return true; }
  }
  function responseBodyAllowed(rawUrl) {
    try { return SAFE_RESPONSE_PATHS.has(new URL(String(rawUrl || ''), global.location.href).pathname); }
    catch (_) { return false; }
  }

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
        .replace(/(?:sb_secret_|sk[-_](?:proj[-_]|live_|test_)?|ghp_|gho_|github_pat_|AIza|xox[baprs]-|glpat-|npm_)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
        .replace(/\b(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, '[REDACTED_PHONE]')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED_UUID]')
        .replace(/\b(?:\+?\d{1,3})?\d{10,12}\b/g, '[REDACTED_PHONE]')
        .replace(/((?:password|passwd|token|api[_-]?key|secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
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
    if (!contextEnabled() || !global.parent || global.parent === global) return;
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
    if (!contextEnabled()) return { tool, title: global.document.title, url: safeUrl(global.location.href), inputs: [], outputs: [] };
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
    if (!el || (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable && !(el.closest && el.closest('[contenteditable="true"],.cm-content'))) || el.type === 'password') return;
    const meta = { id: el.id || '', name: el.getAttribute('name') || '', type: el.type || el.tagName.toLowerCase(), label: fieldLabel(el) };
    meta.value = SENSITIVE.test([meta.id, meta.name, meta.type, meta.label].join(' ')) ? '[REDACTED]' : sanitize(el.value !== undefined ? el.value : (el.innerText || el.textContent || ''), '', 0);
    send('input', meta);
  }, true);

  global.document.addEventListener('change', event => {
    const el=event.target;
    if(!el||(!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&!el.isContentEditable&&!(el.closest&&el.closest('[contenteditable="true"],.cm-content')))||el.type==='password')return;
    const meta={id:el.id||'',name:el.getAttribute('name')||'',type:el.type||el.tagName.toLowerCase(),label:fieldLabel(el)};
    meta.value=SENSITIVE.test([meta.id,meta.name,meta.type,meta.label].join(' '))?'[REDACTED]':sanitize(el.tagName==='SELECT'?el.options[el.selectedIndex]?.text:(el.value!==undefined?el.value:(el.innerText||el.textContent||'')),'',0);
    send('change',meta);
  },true);

  global.document.addEventListener('submit', event => {
    const form=event.target;
    if(!form||form.tagName!=='FORM')return;
    send('form_submit',{id:form.id||'',name:form.getAttribute('name')||'',action:safeUrl(form.getAttribute('action')||global.location.href),method:String(form.method||'GET').toUpperCase()});
  },true);

  global.document.addEventListener('click', event => {
    const el = event.target && event.target.closest ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
    if (!el) return;
    send('click', { tag: el.tagName.toLowerCase(), id: el.id || '', text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 120) });
  }, true);

  function engineRequestInfo(rawUrl, init, input) {
    try {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : (rawUrl && rawUrl.url) || '', global.location.href);
      if (!/\/(?:run|health)(?:\/|$)/i.test(url.pathname)) return null;
      const saved = ['nexus_colab_url','qcol_colab_url','openq_colab_url'].map(k => {
        try { return global.localStorage.getItem(k); } catch (_) { return ''; }
      }).filter(Boolean);
      const known = saved.some(value => { try { return new URL(value).origin === url.origin; } catch (_) { return false; } });
      const virtualNexusEndpoint = url.hostname === 'nexus-connectors.invalid';
      if (!known && !/\.hf\.space$/i.test(url.hostname) && !virtualNexusEndpoint) return null;
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const headers = new Headers((init && init.headers) || (input && input.headers) || {});
      const requestedSlot = (init && init.nexusSlot) || headers.get('X-Nexus-Slot') || 'cpu';
      const requestedConnector = (init && init.nexusConnector) || headers.get('X-Nexus-Connector') || '';
      const requestedModule = (init && init.nexusModule) || global.__QUOLAB_NEXUS_MODULE || '';
      headers.delete('X-Nexus-Slot');
      headers.delete('X-Nexus-Connector');
      headers.delete('X-Nexus-Module');
      const cleanHeaders = {};
      headers.forEach((value, key) => { if (!/^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(key)) cleanHeaders[key] = value; });
      return { slot: requestedSlot, connector:requestedConnector, module:requestedModule, path: url.pathname + url.search, method, headers: cleanHeaders, body: init && init.body, timeout: init && init.timeout };
    } catch (_) { return null; }
  }
  function installNexusAPI() {
    const filename = global.location.pathname.split('/').pop();
    const modules = {
      'quolab-nexus-architect.html': { slots:['cpu','qpu','storage'], tool:'architect' },
      'quolab-nexus-quantum-notebook.html': { slots:['cpu','storage'], tool:'architect-pro' },
      'quolab-nexus-quantum-puzzle.html': { slots:['cpu','qpu'], tool:'quantum-puzzle' },
      'quolab-nexus-app-studio.html': { slots:['cpu','qpu','storage'], tool:'quantum-app-studio' }
    };
    const config = modules[filename];
    if (!config || !global.QuOLabNexusCore || !global.QuOLabNexusCore.api) return Promise.resolve(null);
    const api = global.QuOLabNexusCore.api;
    global.__QUOLAB_NEXUS_MODULE = config.tool;
    global.QuOLabNexusAPI = api;
    return new Promise(resolve => global.setTimeout(async () => {
      config.slots.forEach(slot => api.register(slot, config.tool + ' · ' + slot.toUpperCase(), slot === 'cpu' ? 'engine' : ''));
      try { await api.getRoutes(); } catch (_) {}
      resolve(api);
    }, 450));
  }
  global.QuOLabNexusReady = installNexusAPI();

  if (typeof global.fetch === 'function') {
    const originalFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const body = init && init.body;
      const telemetryEnabled = contextEnabled();
      if (telemetryEnabled) send('request', { method, url: safeUrl(url), body: '[OMITTED]', bodyLength: typeof body === 'string' ? body.length : body ? -1 : 0 });
      // Routing is transport control, not telemetry: disabling AI context must not bypass Nexus.
      const routed = engineRequestInfo(url, init, input);
      if (routed && global.QuOLabNexusReady) {
        return global.QuOLabNexusReady.then(api => {
          if (!api) throw new Error('Nexus API broker is unavailable for this module');
          return api.request(routed.slot, routed);
        }).then(result => {
          const response = new Response(result.text || '', { status: result.status || 200, headers: result.headers || {} });
          send('response', { method, url: safeUrl(url), status: response.status, ok: response.ok, body: responseBodyAllowed(url) ? sanitize(result.text || '', '', 0) : '[NOT_ALLOWLISTED]' });
          return response;
        }).catch(error => { send('network_error', { method, url: safeUrl(url), message: error.message || 'Nexus route failed' }); throw error; });
      }
      return originalFetch(input, init).then(response => {
        if (telemetryEnabled && !response.ok) send('http_error',{method,url:safeUrl(url),status:response.status,statusText:String(response.statusText||'').slice(0,120)});
        try {
          const copy = response.clone();
          copy.text().then(text => {
            if (telemetryEnabled && contextEnabled()) {
              if (responseBodyAllowed(url)) {
                let payload = text;
                try { payload = JSON.parse(text); } catch (_) {}
                send('response', { method, url: safeUrl(url), status: response.status, ok: response.ok, body: sanitize(payload, '', 0) });
              } else send('response', { method, url: safeUrl(url), status: response.status, ok: response.ok, body: '[NOT_ALLOWLISTED]' });
            }
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
        if (!contextEnabled()) return originalSend.apply(this, arguments);
        send('request', { method: meta.method, url: meta.url, body: '[OMITTED]', bodyLength: typeof body === 'string' ? body.length : body ? -1 : 0 });
        this.addEventListener('load', function () {
          if(this.status>=400)send('http_error',{method:meta.method,url:meta.url,status:this.status,statusText:String(this.statusText||'').slice(0,120)});
          let payload = '';
          try { payload = this.responseType === 'json' ? this.response : (this.responseText || ''); } catch (_) {}
          try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch (_) {}
          if (contextEnabled()) {
            if (responseBodyAllowed(meta.url)) send('response', { method: meta.method, url: meta.url, status: this.status, body: sanitize(payload, '', 0) });
            else send('response', { method: meta.method, url: meta.url, status: this.status, body: '[NOT_ALLOWLISTED]' });
          }
        }, { once: true });
        this.addEventListener('error', function () { send('network_error', { method: meta.method, url: meta.url, message: 'XMLHttpRequest failed' }); }, { once: true });
        return originalSend.apply(this, arguments);
      };
      proto.__quolabNexusWrapped = true;
    }
  } catch (_) {}

  // Observe storage writes per instance; never transmit auth, account or AI-provider secrets.
  for (const storageName of ['localStorage','sessionStorage']) {
    try {
      const storage=global[storageName];
      if(!storage||storage.__quolabNexusWrapped)continue;
      const proto=Object.getPrototypeOf(storage);
      const originalSet=proto.setItem,originalRemove=proto.removeItem,originalClear=proto.clear;
      Object.defineProperties(storage,{
        __quolabNexusWrapped:{value:true},
        setItem:{configurable:true,value:function(key,value){
          const result=originalSet.call(this,key,value);
          const safeKey=String(key||'').slice(0,120);
          const hidden=/(?:user|account|auth|session|token|secret|key|password|credential|openq_ai)/i.test(safeKey);
          send('storage_write',{storage:storageName,key:safeKey,value:hidden?'[REDACTED]':sanitize(String(value||''),'',0),length:String(value||'').length});
          return result;
        }},
        removeItem:{configurable:true,value:function(key){const result=originalRemove.call(this,key);send('storage_remove',{storage:storageName,key:String(key||'').slice(0,120)});return result;}},
        clear:{configurable:true,value:function(){const result=originalClear.call(this);send('storage_clear',{storage:storageName});return result;}}
      });
    } catch(_){}
  }

  // Quantum App Studio is nested inside the Quantum Puzzle page.
  // Relay its sanitized telemetry through the puzzle frame to the central agent.
  global.addEventListener('message', event => {
    if (event.origin !== global.location.origin || !event.data || event.data.type !== 'NEXUS_TOOL_EVENT') return;
    const child = Array.from(global.document.querySelectorAll('iframe')).find(frame => frame.contentWindow === event.source);
    if (!child || !(child.getAttribute('src') || '').includes('quolab-nexus-app-studio.html')) return;
    const payload = event.data;
    send('nested_tool_event', {
      tool: 'quantum-app-studio',
      kind: String(payload.kind || 'event').slice(0, 60),
      details: payload.details || {}
    });
  }, true);

  // Observe only rendered output/result regions so the coordinator sees
  // tool results as they change, without streaming entire page contents.
  let lastOutputSignature = '';
  let outputTimer = null;
  function reportOutputChanges() {
    const outputs = Array.from(global.document.querySelectorAll('pre,output,[aria-live="polite"],[aria-live="assertive"],[id*="output" i],[class*="output" i],[id*="result" i],[class*="result" i]'))
      .slice(0, 20)
      .map(el => sanitize(el.innerText || el.textContent || '', '', 0))
      .filter(Boolean);
    const signature = JSON.stringify(outputs);
    if (signature && signature !== lastOutputSignature) {
      lastOutputSignature = signature;
      send('output_change', { outputs });
    }
  }
  if (global.MutationObserver && global.document.body) {
    const outputObserver = new MutationObserver(() => {
      if (outputTimer) clearTimeout(outputTimer);
      outputTimer = setTimeout(reportOutputChanges, 250);
    });
    outputObserver.observe(global.document.body, { subtree: true, childList: true, characterData: true });
  }

  if(global.console&&typeof global.console.error==='function'&&!global.console.__quolabNexusWrapped){
    const originalError=global.console.error.bind(global.console);
    global.console.error=function(...args){send('console_error',{message:sanitize(args.map(value=>typeof value==='string'?value:(value&&value.message)||String(value)).join(' ').slice(0,1200),'',0)});return originalError(...args);};
    try{Object.defineProperty(global.console,'__quolabNexusWrapped',{value:true});}catch(_){}
  }

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
