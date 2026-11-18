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
    envelope,
    sendToParent
  };
})(window);
