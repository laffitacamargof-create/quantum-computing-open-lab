const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
global.window = global;
global.crypto = webcrypto;
global.localStorage = new MemoryStorage();
global.BroadcastChannel = class { postMessage() {} close() {} };
global.document = { currentScript: { src: 'https://example.test/quolab-nexus-connectors-core.js' } };
require('../../quolab-nexus-connectors-core.js');

(async () => {
  const NC = global.QuOLabNexusConnectors;
  const make = async (name, category, tools=[]) => {
    const rec = await NC.Make.ext({ name, category, baseUrl:'https://api.example.test/v1', auth:'apikey', tools, usage:'always' });
    NC.Store.upsert(rec);
    return rec;
  };
  const cpu1 = await make('CPU-1','classical');
  const cpu2 = await make('CPU-2','classical');
  NC.Assignments.bind(cpu1.id,'open_lab','cpu');
  assert.throws(() => NC.Assignments.bind(cpu2.id,'open_lab','cpu'), /only allows 1 CPU/);
  NC.Assignments.bind(cpu1.id,'notebook','cpu');
  NC.Assignments.bind(cpu1.id,'apps','cpu');
  NC.Assignments.bind(cpu2.id,'apps','cpu');
  assert.deepEqual(NC.Assignments.get('quantum-puzzle','cpu'), [cpu1.id,cpu2.id]);

  const qpu1 = await make('QPU-1','quantum');
  const qpu2 = await make('QPU-2','quantum');
  assert.throws(() => NC.Assignments.bind(qpu1.id,'notebook','qpu'), /only allows 0 QPU/);
  NC.Assignments.bind(qpu1.id,'open_lab','qpu');
  NC.Assignments.bind(qpu1.id,'apps','qpu');
  NC.Assignments.bind(qpu2.id,'apps','qpu');
  assert.deepEqual(NC.Assignments.get('quantum-puzzle','qpu'), [qpu1.id,qpu2.id]);

  const storage1 = await make('Storage-1','storage');
  const storage2 = await make('Storage-2','storage');
  NC.Assignments.bind(storage1.id,'open_lab','storage');
  NC.Assignments.bind(storage2.id,'open_lab','storage');
  NC.Assignments.bind(storage1.id,'notebook','storage');
  NC.Assignments.bind(storage1.id,'app_studio','storage');
  assert.throws(() => NC.Assignments.bind(storage2.id,'app_studio','storage'), /only allows 1 STORAGE/);
  assert.throws(() => NC.Assignments.bind(storage1.id,'apps','storage'), /only allows 0 STORAGE/);

  assert.throws(() => NC.Assignments.set('architect','cpu',[cpu1.id,cpu2.id]), /only allows 1 CPU/);
  NC.Store.patch(cpu1.id, r => { r.usage='off'; });
  assert.throws(() => NC.Assignments.bind(cpu1.id,'open_lab','cpu'), /Enable the connector/);
  NC.Store.remove(cpu2.id);
  assert.equal(NC.Assignments.get('quantum-puzzle','cpu').includes(cpu2.id), false);

  const routeCpu = await make('Route CPU','classical');
  NC.Assignments.set('architect','cpu','founder');
  NC.Assignments.bind(routeCpu.id,'open_lab','cpu');
  let fetchedUrl = '';
  global.fetch = async url => { fetchedUrl=String(url); return new Response('ok',{status:200}); };
  await NC.ext.request({tool:'open_lab',connector:routeCpu.id,kind:'cpu',path:'/admin'});
  assert.equal(fetchedUrl,'https://api.example.test/v1/admin');
  await assert.rejects(
    NC.ext.request({tool:'open_lab',connector:routeCpu.id,path:'/run'}),
    e => e.code === 'assignment-required'
  );
  const unassignedCpu = await make('Unassigned CPU','classical');
  await assert.rejects(
    NC.requestAssigned({moduleId:'architect',kind:'cpu',tool:'open_lab',connector:unassignedCpu.id,path:'/run'}),
    e => e.code === 'not-assigned'
  );
  NC.Store.remove(unassignedCpu.id);
  NC.Store.remove(routeCpu.id);

  const privateUrl = await make('Private URL','classical');
  NC.Store.patch(privateUrl.id,r=>{r.ext.baseUrl='https://127.0.0.1/v1';});
  NC.Assignments.bind(privateUrl.id,'open_lab','cpu');
  await assert.rejects(
    NC.ext.request({tool:'open_lab',connector:privateUrl.id,kind:'cpu',path:'/run'}),
    e => e.code === 'scope'
  );
  NC.Store.remove(privateUrl.id);

  const credentialUrl = await make('Credential URL','classical');
  NC.Store.patch(credentialUrl.id,r=>{r.ext.baseUrl='https://user:pw@api.example.test/v1';});
  NC.Assignments.bind(credentialUrl.id,'open_lab','cpu');
  await assert.rejects(
    NC.ext.request({tool:'open_lab',connector:credentialUrl.id,kind:'cpu',path:'/run'}),
    e => e.code === 'scope'
  );
  NC.Store.remove(credentialUrl.id);

  const ai = await NC.Make.ai({name:'AI once',provider:'other',usage:'once'});
  assert.equal(ai.usage,'always');
  assert.equal(typeof NC.Vault.open,'undefined');
  assert.equal(typeof NC.ext._headers,'undefined');
  assert.equal(typeof NC.ext._url,'undefined');

  const offCpu = await make('Disabled CPU','classical');
  NC.Assignments.bind(offCpu.id,'open_lab','cpu');
  NC.Store.patch(offCpu.id,r=>{r.usage='off';});
  let routeError;
  try { await NC.requestAssigned({moduleId:'architect',kind:'cpu',tool:'open_lab',path:'/run'}); }
  catch (e) { routeError=e.code; }
  assert.equal(routeError,'assigned-unavailable');
  NC.Store.remove(offCpu.id);
  console.log('Nexus Connectors slot and API boundary checks passed');
})().catch(err => { console.error(err); process.exitCode=1; });
