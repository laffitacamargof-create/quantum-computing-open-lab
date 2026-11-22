'use strict';
const assert = require('assert');
const T = require('../quolab-nexus-theoretical-gates.js');
function mem(){ const m={}; return { getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v)}, removeItem:k=>{delete m[k]}, _m:m }; }
let n=0; function t(name,fn){ try{ fn(); n++; console.log('ok  '+name);}catch(e){ console.error('FAIL '+name+'\n  '+(e.stack||e)); process.exitCode=1; } }
const close=(a,b,e)=>Math.abs(a-b)<(e||1e-9);
const M=(U)=>T.matrixToText(U,6);

t('CX little-endian matrix', ()=>{
  const U=T.matrixOfBasic('cx'); const want=[[1,0,0,0],[0,0,0,1],[0,0,1,0],[0,1,0,0]];
  for(let i=0;i<4;i++)for(let j=0;j<4;j++) assert(close(U.re[i*4+j],want[i][j]),'cx '+i+j);
});
t('order U = B·A', ()=>{
  const c=new T.Catalog(mem());
  const r=c.create({name:'Fx',nq:1,ops:[{g:'h',q:[0],p:[]},{g:'s',q:[0],p:[]}]}); assert(r.ok,r.error);
  const U=T.matrixOfGate(r.gate.id,null,[],c); // S·H
  const s2=Math.SQRT1_2; // S·H = [[s2,s2],[i s2,-i s2]]
  assert(close(U.re[0],s2)&&close(U.re[1],s2)&&close(U.im[2],s2)&&close(U.im[3],-s2));
});
t('2-qubit expansion respects qubit order', ()=>{
  const c=new T.Catalog(mem());
  const r=c.create({name:'Flip',nq:2,ops:[{g:'cx',q:[1,0],p:[]}]}); // control q1, target q0
  const U=T.matrixOfGate(r.gate.id,null,[],c);
  // |q1 q0>: 10 -> 11 : index 2 -> 3
  assert(close(U.re[3*4+2],1)&&close(U.re[2*4+3],1)&&close(U.re[0],1)&&close(U.re[5],1));
});
t('labels F, F2, F3 stable, never reused', ()=>{
  const c=new T.Catalog(mem()); const mk=(n)=>c.create({name:n,nq:1,ops:[{g:'x',q:[0],p:[]}]}).gate;
  const a=mk('Fourier'),b=mk('Flip'),d=mk('Fan');
  assert.deepStrictEqual([a.label,b.label,d.label],['F','F2','F3']);
  c.remove(b.id); const e=mk('Foo'); assert.strictEqual(e.label,'F4');
});
t('nested gates + params + versions + pinning', ()=>{
  const c=new T.Catalog(mem()); const saved=[{name:'c1',code:'qc.A(0.5, 0)\n'}];
  c.hooks.savedCircuits={list:()=>saved,replace:(i,code)=>{saved[i].code=code;}};
  const a=c.create({name:'Alpha',nq:1,params:[{name:'t',def:0}],ops:[{g:'rz',q:[0],p:['t']}]}).gate;
  const b=c.create({name:'Beta',nq:2,ops:[{g:'@'+a.id,v:1,q:[1],p:['pi/2']},{g:'cx',q:[0,1],p:[]}]}); assert(b.ok,b.error);
  assert.strictEqual(c.dependents(a.id).gates.length,1);
  assert(c.remove(a.id).blocked);
  const u=c.update(a.id,{name:'Alpha',nq:1,params:[{name:'t',def:0}],ops:[{g:'ry',q:[0],p:['t']}]},'version');
  assert(u.ok); assert.strictEqual(a.current,2); assert.strictEqual(a.versions.length,2);
  assert(/qc\.A_v1\(/.test(saved[0].code),'pinned: '+saved[0].code);
  const U1=T.matrixOfGate(a.id,1,[Math.PI],c), U2=T.matrixOfGate(a.id,2,[Math.PI],c);
  assert(Math.abs(U1.im[0]+1)<1e-9); assert(Math.abs(U2.re[1]+1)<1e-9);
});
t('circular dependency rejected', ()=>{
  const c=new T.Catalog(mem()); const a=c.create({name:'A1',nq:1,ops:[{g:'x',q:[0],p:[]}]}).gate;
  const r=c.update(a.id,{name:'A1',nq:1,ops:[{g:'@'+a.id,v:1,q:[0],p:[]}]},'overwrite'); assert(!r.ok);
});
t('non-unitary ops rejected', ()=>{
  const c=new T.Catalog(mem()); const r=c.create({name:'M',nq:1,ops:[{g:'measure',q:[0],p:[]}]}); assert(!r.ok);
});
t('persistence, corruption, quota, import/export', ()=>{
  const s=mem(); let c=new T.Catalog(s); c.create({name:'Keep',nq:1,ops:[{g:'h',q:[0],p:[]}]});
  c=new T.Catalog(s); assert.strictEqual(c.list().length,1);
  const json=c.exportJSON(); const c2=new T.Catalog(mem()); c2.create({name:'Kappa',nq:1,ops:[{g:'x',q:[0],p:[]}]});
  const imp=c2.importJSON(json); assert(imp.ok,imp.error); assert.strictEqual(c2.list().length,2);
  assert.notStrictEqual(c2.list()[0].label,c2.list()[1].label);
  s.setItem(T.STORE_KEY,'{bad'); const c3=new T.Catalog(s); assert.strictEqual(c3.list().length,0); assert(c3.lastError);
  assert(Object.keys(s._m).some(k=>k.indexOf('_corrupt_')>0));
  const q=mem(); q.setItem=()=>{const e=new Error('q');e.name='QuotaExceededError';throw e;};
  const c4=new T.Catalog(q); const r=c4.create({name:'Z',nq:1,ops:[{g:'x',q:[0],p:[]}]}); assert(!r.ok&&/full/i.test(r.error)); assert.strictEqual(c4.list().length,0);
});
t('python subset parser accepts gates/loops, rejects code', ()=>{
  const c=new T.Catalog(mem()); const a=c.create({name:'Alpha',nq:1,ops:[{g:'x',q:[0],p:[]}]}).gate;
  const ok=T.parsePython('qc.h(0)\nfor i in range(2):\n    qc.cx(i, i+1)\nqc.rz(pi/2, 1)\nqc.A(2)\n',{catalog:c,nq:3,params:[]});
  assert(ok.ok,JSON.stringify(ok.errors)); assert.strictEqual(ok.ops.length,5);
  for(const bad of ['import os','__import__("os")','qc.h(0); open("x")','exec("1")','qc.h(__import__("os"))','qc.h(0)\nos.system("ls")','x = [i for i in range(9**9)]']){
    const r=T.parsePython(bad,{catalog:c,nq:3,params:[]}); assert(!r.ok,'accepted: '+bad);
  }
});
t('prelude generated and aliases', ()=>{
  const c=new T.Catalog(mem()); const a=c.create({name:'Fx',nq:2,params:[{name:'t',def:0}],ops:[{g:'h',q:[0],p:[]},{g:'rz',q:[1],p:['t*2']},{g:'cx',q:[0,1],p:[]}]}).gate;
  const code='from qiskit import QuantumCircuit\nqc=QuantumCircuit(2)\nqc.F(0.3, 0, 1)\n';
  const out=T.injectPrelude(code,c); assert(/qtg_/.test(out)); assert(T.stripPrelude(out).trim()===code.trim());
  assert.strictEqual(T.injectPrelude('qc.h(0)',c),'qc.h(0)');
  const ar=T.arityOf('F',c); assert.strictEqual(ar.nq,2); assert.strictEqual(ar.np,1);
  assert.strictEqual(T.callFor({tg:{id:a.id,v:1,params:[0.3]},qs:[0,1]},c),'qc.F(0.3, 0, 1)');
});
t('matrix too large is explained, not fabricated', ()=>{
  const c=new T.Catalog(mem()); const ops=[]; for(let i=0;i<10;i++)ops.push({g:'h',q:[i],p:[]});
  const g=c.create({name:'Big',nq:10,ops}).gate; assert.throws(()=>T.matrixOfGate(g.id,null,[],c),/not computed/);
});
console.log(n+' passed');
