/* ============================================================
   repo-sync.js — QCOL Cloud Repository
   Base común en Supabase para Notebooks / PDFs / Videos.
   Sin moderación: lo que se publica queda visible al instante.
   Solo usa la clave PÚBLICA (publishable). Nunca pongas aquí
   la clave secret/service.
   Se carga como script clásico (etiqueta script con src="repo-sync.js")
   y queda disponible como  window.RepoSync
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    url: 'https://rtkcfbnoqbivylejhspv.supabase.co',
    key: 'sb_publishable_Uw4ViBXo3UvvlSHzOiAcDA_9Jn6eMcf'
  };

  var LS_KEYS    = 'qcol_repo_keys';        // { itemId: editKey }  (llaves de edición de MIS items)
  var LS_FOUNDER = 'qcol_repo_founder_key'; // llave del fundador (solo en su navegador)
  var LS_LINKS   = 'qcol_repo_links';       // { nombreLocalNotebook: itemId }
  var LS_CACHE   = 'qcol_repo_cache';       // copia de la lista para modo offline
  var MAX_BYTES  = 1900000;                 // ~1.9 MB por item (el SQL limita a 2 MB)

  var LIST_COLS = 'id,kind,slug,title,description,tags,cell_count,est_minutes,' +
                  'author_name,file_url,version,created_at,updated_at';

  /* ---------- helpers de almacenamiento local ---------- */
  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function randomKey() {
    var a = new Uint8Array(24);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------- petición HTTP a Supabase ---------- */
  async function request(path, opts) {
    opts = opts || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 25000);
    try {
      var res = await fetch(CFG.url + '/rest/v1/' + path, {
        method: opts.method || 'GET',
        cache: 'no-store',
        headers: {
          'apikey': CFG.key,
          'Authorization': 'Bearer ' + CFG.key,
          'Content-Type': 'application/json'
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal
      });
      var text = await res.text();
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        var msg = (data && data.message) ? data.message : ('HTTP ' + res.status);
        var err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function checkSize(content) {
    if (content == null) return;
    if (JSON.stringify(content).length > MAX_BYTES) {
      throw new Error('Notebook too large (max ~2 MB)');
    }
  }

  /* ---------- llaves de edición ---------- */
  function ownKey(id)      { return (lsGet(LS_KEYS, {}) || {})[id] || null; }
  function hasOwnKey(id)   { return !!ownKey(id); }
  function setOwnKey(id, k){ var m = lsGet(LS_KEYS, {}) || {}; m[id] = k; lsSet(LS_KEYS, m); }
  function delOwnKey(id)   { var m = lsGet(LS_KEYS, {}) || {}; delete m[id]; lsSet(LS_KEYS, m); }

  function getFounderKey()   { try { return localStorage.getItem(LS_FOUNDER) || ''; } catch (e) { return ''; } }
  function setFounderKey(k)  { try { localStorage.setItem(LS_FOUNDER, k); } catch (e) {} }
  function clearFounderKey() { lsDel(LS_FOUNDER); }

  async function verifyFounder(k) {
    var r = await request('rpc/repo_is_founder', { method: 'POST', body: { p_key: k } });
    return r === true;
  }

  /* ---------- vínculo notebook local -> item en la nube ---------- */
  function linkName(n) { return String(n || '').trim().toLowerCase(); }
  function getLinked(name) { return (lsGet(LS_LINKS, {}) || {})[linkName(name)] || null; }
  function link(name, id)  { var m = lsGet(LS_LINKS, {}) || {}; m[linkName(name)] = id; lsSet(LS_LINKS, m); }
  function unlinkId(id) {
    var m = lsGet(LS_LINKS, {}) || {};
    Object.keys(m).forEach(function (k) { if (m[k] === id) delete m[k]; });
    lsSet(LS_LINKS, m);
  }

  /* ---------- lectura ---------- */
  async function list() {
    var rows = await request('repo_items?select=' + LIST_COLS + '&order=created_at.desc&limit=1000');
    rows = rows || [];
    lsSet(LS_CACHE, rows);
    return rows;
  }
  function getCached() { return lsGet(LS_CACHE, []) || []; }

  async function getOne(id, cols) {
    var rows = await request('repo_items?id=eq.' + encodeURIComponent(id) +
                             '&select=' + (cols || LIST_COLS) + '&limit=1');
    return rows && rows[0] ? rows[0] : null;
  }
  async function getContent(id) {
    var row = await getOne(id, 'id,title,description,content');
    if (!row) throw new Error('not_found');
    return row;
  }

  /* ---------- escritura (siempre vía funciones SQL) ---------- */
  // item: {kind,title,description,tags,cell_count,est_minutes,author,content,file_url,slug,founderKey}
  async function create(item) {
    var kind = item.kind || 'nb';
    var editKey = (kind === 'nb') ? randomKey() : (item.founderKey || '');
    checkSize(item.content);
    var body = {
      p_kind: kind,
      p_title: item.title,
      p_edit_key: editKey,
      p_description: item.description || '',
      p_tags: item.tags || '',
      p_cell_count: item.cell_count || 0,
      p_est_minutes: item.est_minutes || 10,
      p_author: item.author || '',
      p_file_url: item.file_url || ''
    };
    if (item.content != null) body.p_content = item.content;
    if (item.slug) body.p_slug = item.slug;
    var id = await request('rpc/repo_create', { method: 'POST', body: body });
    if (kind === 'nb') setOwnKey(id, editKey);
    return id;
  }

  // fields: solo se envían los que vengan definidos
  async function update(id, key, fields) {
    fields = fields || {};
    checkSize(fields.content);
    var map = {
      title: 'p_title', description: 'p_description', tags: 'p_tags',
      cell_count: 'p_cell_count', est_minutes: 'p_est_minutes',
      content: 'p_content', file_url: 'p_file_url'
    };
    var body = { p_id: id, p_key: key };
    Object.keys(map).forEach(function (f) {
      if (fields[f] !== undefined && fields[f] !== null) body[map[f]] = fields[f];
    });
    await request('rpc/repo_update', { method: 'POST', body: body });
    return true;
  }

  async function remove(id, key) {
    await request('rpc/repo_delete', { method: 'POST', body: { p_id: id, p_key: key } });
    delOwnKey(id);
    unlinkId(id);
    return true;
  }

  /* ---------- actualización automática (ligera) ---------- */
  var pollTimer = null, lastSig = '', visHandler = null;
  function startPolling(cb, ms) {
    stopPolling();
    async function tick(force) {
      try {
        var rows = await list();
        var sig = JSON.stringify(rows);
        if (force || sig !== lastSig) { lastSig = sig; cb(rows, null); }
      } catch (e) { cb(null, e); }
    }
    tick(true);
    pollTimer = setInterval(function () { if (!document.hidden) tick(false); }, ms || 30000);
    visHandler = function () { if (!document.hidden) tick(false); };
    document.addEventListener('visibilitychange', visHandler);
    return function refresh() { return tick(true); };
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; }
  }

  /* ---------- mensajes de error legibles ---------- */
  function friendlyError(e) {
    var m = (e && e.message) ? e.message : String(e);
    if (/forbidden/i.test(m))        return 'Not allowed (wrong key)';
    if (/not_found/i.test(m))        return 'Item no longer exists';
    if (/duplicate key|slug/i.test(m)) return 'That ID already exists';
    if (/too large/i.test(m))        return 'Content too large (max ~2 MB)';
    if (/invalid url/i.test(m))      return 'URL must start with http:// or https://';
    if (/failed to fetch|networkerror|timed out/i.test(m)) return 'No connection to the cloud';
    return m;
  }

  global.RepoSync = {
    list: list, getCached: getCached, getOne: getOne, getContent: getContent,
    create: create, update: update, remove: remove,
    ownKey: ownKey, hasOwnKey: hasOwnKey,
    getFounderKey: getFounderKey, setFounderKey: setFounderKey,
    clearFounderKey: clearFounderKey, verifyFounder: verifyFounder,
    getLinked: getLinked, link: link,
    startPolling: startPolling, stopPolling: stopPolling,
    friendlyError: friendlyError
  };
})(window);
