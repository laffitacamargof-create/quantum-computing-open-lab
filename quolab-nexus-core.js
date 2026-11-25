/* QuOLab Nexus — central message protocol v1 */
(function (global) {
  'use strict';
  const PREFIX = 'NEXUS_';
  const BUILD = '20261125-pc-routing-1';
  function getEngineUrl() {
    try {
      return ['openq_colab_url','qcol_colab_url','nexus_colab_url'].map(k => String(global.localStorage.getItem(k) || '').trim()).find(Boolean) || '';
    } catch (_) { return ''; }
  }
  function announceBuild() {
    if (!global.parent || global.parent === global) return;
    try { global.top.postMessage({ type:'OPENQ_MODULE_BUILD', build:BUILD, href:global.location.href }, global.location.origin); } catch (_) {}
  }
  global.addEventListener('message', event => {
    if ((event.source !== global.parent && event.source !== global.top) || event.origin !== global.location.origin) return;
    const data = event.data || {};
    if (data.type !== 'NEXUS_BUILD_MISMATCH' || !data.build || data.build === BUILD) return;
    const notice = global.document.createElement('div');
    notice.textContent = 'QuOLab Nexus se está actualizando para corregir una versión antigua en caché…';
    notice.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:14px;background:#7a3e00;color:white;font:14px sans-serif;text-align:center';
    global.document.body ? global.document.body.appendChild(notice) : global.document.addEventListener('DOMContentLoaded',()=>global.document.body.appendChild(notice),{once:true});
    const url = new URL(global.location.href); url.searchParams.set('v', data.build); url.searchParams.set('cb', String(Date.now()));
    global.location.replace(url.href);
  });
  global.addEventListener('load', announceBuild, { once:true });
  const LEGACY = /^(?:OPENQ|QCOL|NEXUS)_(.+)$/;
  function canonicalType(type) {
    if (typeof type !== 'string') return type;
    const match = type.match(LEGACY);
    return match ? PREFIX + match[1] : type;
  }
  function legacyType(type) {
    const canonical = canonicalType(type);
    return typeof canonical === 'string' && canonical.indexOf(PREFIX) === 0
      ? 'OPENQ_' + canonical.slice(PREFIX.length) : canonical;
  }
  function normalizeIncoming(message) {
    if (!message || typeof message !== 'object') return message;
    return Object.assign({}, message, { type: canonicalType(message.type) });
  }
  function getFounderKey() {
    try {
      const current = global.localStorage.getItem('nexus_founder_key');
      if (current) return current;
      const legacy = global.localStorage.getItem('openq_repo_founder_key') || global.localStorage.getItem('qcol_repo_founder_key') || '';
      if (legacy) { global.localStorage.setItem('nexus_founder_key', legacy); global.localStorage.removeItem('openq_repo_founder_key'); global.localStorage.removeItem('qcol_repo_founder_key'); }
      return legacy;
    } catch (_) { return ''; }
  }
  let apiRequestSeq = 0;
  function brokerWindow() { return global.top && global.top !== global ? global.top : (global.parent && global.parent !== global ? global.parent : null); }
  function sendToBroker(type, payload) {
    const broker = brokerWindow();
    if (!broker) return false;
    try { broker.postMessage(envelope(type, payload), global.location.origin); return true; } catch (_) { return false; }
  }
  function requestParent(type, responseType, payload, timeout) {
    return new Promise((resolve, reject) => {
      const broker = brokerWindow();
      if (!broker) return reject(new Error('Nexus API broker is not available outside the ecosystem shell'));
      const id = 'nexus-' + Date.now().toString(36) + '-' + (++apiRequestSeq).toString(36);
      const limit = Math.max(1000, Math.min(Number(timeout) || 30000, 120000));
      const handler = event => {
        if (event.source !== broker || event.origin !== global.location.origin) return;
        const data = normalizeIncoming(event.data || {});
        if (data.type !== responseType || data.id !== id) return;
        global.removeEventListener('message', handler);
        global.clearTimeout(timer);
        if (data.ok === false) reject(new Error(data.error || 'Nexus API request failed'));
        else resolve(data);
      };
      const timer = global.setTimeout(() => {
        global.removeEventListener('message', handler);
        reject(new Error('Nexus API broker timed out'));
      }, limit);
      global.addEventListener('message', handler);
      if (!sendToBroker(type, Object.assign({}, payload || {}, { id }))) {
        global.removeEventListener('message', handler);
        global.clearTimeout(timer);
        reject(new Error('Could not reach the Nexus API broker'));
      }
    });
  }
  const api = {
    register(slot, label, founder, module) {
      return sendToBroker('NEXUS_API_REGISTER', { slot, label, founder, module:module || global.__QUOLAB_NEXUS_MODULE || '' });
    },
    getRoutes(module) {
      return requestParent('NEXUS_GET_API_ROUTES', 'NEXUS_API_ROUTES', { module:module || global.__QUOLAB_NEXUS_MODULE || '' }, 10000);
    },
    request(slot, options) {
      if (!['cpu','qpu','storage'].includes(String(slot))) return Promise.reject(new Error('Unsupported Nexus API slot'));
      return requestParent('NEXUS_API_REQUEST', 'NEXUS_API_RESULT', Object.assign({ module:global.__QUOLAB_NEXUS_MODULE || '' }, options || {}, { slot }), options && options.timeout);
    },
    chat(messages, options) {
      return requestParent('NEXUS_AI_CHAT', 'NEXUS_AI_RESULT', Object.assign({ module:global.__QUOLAB_NEXUS_MODULE || '' }, options || {}, { messages }), options && options.timeout);
    },
    storage: {
      save(options) { return api.request('storage', Object.assign({ method:'PUT' }, options || {})); },
      load(options) { return api.request('storage', Object.assign({ method:'GET' }, options || {})); },
      list(options) { return api.request('storage', Object.assign({ method:'GET' }, options || {})); }
    }
  };
  function envelope(type, payload) {
    return Object.assign({}, payload || {}, { type: canonicalType(type), protocol: 'QUOLAB_NEXUS_V1' });
  }
  function sendToParent(type, payload) {
    if (global.parent && global.parent !== global) {
      global.parent.postMessage(envelope(type, payload), global.location.origin);
      return true;
    }
    return false;
  }
  global.QuOLabNexusCore = {
    protocol: 'QUOLAB_NEXUS_V1',
    build: BUILD,
    getEngineUrl,
    canonicalType,
    legacyType,
    normalizeIncoming,
    getFounderKey,
    api,
    envelope,
    sendToParent
  };
})(window);
