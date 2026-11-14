const $ = (i) => document.getElementById(i);
let found = [], linked = [];
const say = (t, bad) => { $('qb-msg').textContent = t || ''; $('qb-msg').style.color = bad ? '#ff4466' : '#7a9ab8'; };
const isLinked = (a) => linked.some(x => x.address === a);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function draw() {
  const rows = found.slice();
  linked.forEach(l => { if (!rows.some(r => r.address === l.address)) rows.push({ address: l.address, name: '(linked)', rssi: null }); });
  $('qb-list').innerHTML = rows.length ? rows.map(d => `<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .6rem;border:1px solid #1a3a5c;border-radius:8px;margin-bottom:.4rem">
      <span style="color:${isLinked(d.address) ? '#00ff88' : '#7a9ab8'}">●</span>
      <div style="flex:1"><b>${esc(d.name || 'Unnamed device')}</b><div style="color:#7a9ab8;font-size:12px">${esc(d.address)}${d.rssi != null ? ' · ' + d.rssi + ' dBm' : ''}</div></div>
      ${isLinked(d.address) ? `<button data-svc="${esc(d.address)}">DETAILS</button><button data-un="${esc(d.address)}">UNLINK</button>` : `<button data-ln="${esc(d.address)}">LINK</button>`}</div>`).join('')
    : '<div style="color:#7a9ab8">No devices yet. Press SEARCH.</div>';
}
async function refreshLinked() { try { linked = await nexus.call('linked'); } catch (e) { linked = []; } draw(); }

$('qb-scan').onclick = async () => {
  say('Searching…'); $('qb-scan').disabled = true;
  try { found = await nexus.call('scan', { prefix: $('qb-prefix').value.trim(), timeout: 4 }); await refreshLinked(); say(found.length ? found.length + ' device(s) found' : 'Nothing found. Is the Qubi on and close?'); }
  catch (e) { say(e.message, true); } finally { $('qb-scan').disabled = false; }
};
$('qb-list').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.ln) { say('Linking…'); const r = await nexus.call('link', { address: b.dataset.ln }); say('Linked ✓'); await refreshLinked(); }
    else if (b.dataset.un) { await nexus.call('unlink', { address: b.dataset.un }); say('Unlinked'); await refreshLinked(); }
    else if (b.dataset.svc) { const s = await nexus.call('services', { address: b.dataset.svc }); $('qb-svc').style.display = 'block'; $('qb-svc').textContent = JSON.stringify(s, null, 2); }
  } catch (err) { say(err.message, true); }
};
nexus.on('linked', refreshLinked); nexus.on('unlinked', refreshLinked); nexus.on('ble.disconnected', () => { say('A device disconnected'); refreshLinked(); });
refreshLinked();
