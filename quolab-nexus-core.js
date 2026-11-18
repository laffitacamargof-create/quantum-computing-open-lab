/* QuOLab Nexus — central message protocol v1 */
(function (global) {
  'use strict';
  const PREFIX = 'NEXUS_';
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
  function requestParent(type, responseType, payload, timeout) {
    return new Promise((resolve, reject) => {
      if (!global.parent || global.parent === global) return reject(new Error('Nexus API broker is not available outside the ecosystem shell'));
      const id = 'nexus-' + Date.now().toString(36) + '-' + (++apiRequestSeq).toString(36);
      const limit = Math.max(1000, Math.min(Number(timeout) || 30000, 120000));
      const handler = event => {
        if (event.source !== global.parent || event.origin !== global.location.origin) return;
        const data = normalizeIncoming(event.data || {});
        if (data.type !== responseType || data.id !== id) return;
        global.removeEventListener('message', handler);
        global.clearTimeout(timer);
        if (!data.ok) reject(new Error(data.error || 'Nexus API request failed'));
        else resolve(data);
      };
      const timer = global.setTimeout(() => {
        global.removeEventListener('message', handler);
        reject(new Error('Nexus API broker timed out'));
      }, limit);
      global.addEventListener('message', handler);
      if (!sendToParent(type, Object.assign({}, payload || {}, { id }))) {
        global.removeEventListener('message', handler);
        global.clearTimeout(timer);
        reject(new Error('Could not reach the Nexus API broker'));
      }
    });
  }
  const api = {
    register(slot, label, founder) {
      return sendToParent('NEXUS_API_REGISTER', { slot, label, founder });
    },
    getRoutes() {
      return requestParent('NEXUS_GET_API_ROUTES', 'NEXUS_API_ROUTES', {}, 10000);
    },
    request(slot, options) {
      if (!['cpu','qpu','storage'].includes(String(slot))) return Promise.reject(new Error('Unsupported Nexus API slot'));
      return requestParent('NEXUS_API_REQUEST', 'NEXUS_API_RESULT', Object.assign({}, options || {}, { slot }), options && options.timeout);
    },
    chat(messages, options) {
      return requestParent('NEXUS_AI_CHAT', 'NEXUS_AI_RESULT', Object.assign({}, options || {}, { messages }), options && options.timeout);
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
    canonicalType,
    legacyType,
    normalizeIncoming,
    getFounderKey,
    api,
    envelope,
    sendToParent
  };
})(window);
