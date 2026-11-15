const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('quolab-nexus-agent.js','utf8');
const start=source.indexOf('function describeFrame(');
const end=source.indexOf('\n  function snapshot(',start);
assert.ok(start>=0&&end>start,'describeFrame source must exist');
const describeFrame=source.slice(start,end);
const names=['getItems','reload','buildPalette','refreshApps','loadProjects','getItems','getItems'];
const screens=['projects','architect','architect-pro','quantum-puzzle','quantum-app-studio','library','help'];
for(let i=0;i<screens.length;i++){
 const screen=screens[i],fnName=names[i];
 const frameWindow={[fnName]:function(){return 'called:'+screen;}};
 const body={innerText:'Visible '+screen+' tool content'};
 const doc={readyState:'complete',documentElement:{},title:screen,body,activeElement:null,querySelectorAll:()=>[],defaultView:frameWindow};
 const frame={contentDocument:doc,getAttribute:(name)=>name==='src'?'/'+screen+'.html':null};
 const modal={classList:{contains:()=>true}};
 const puzzleFrame={contentDocument:{getElementById:()=>modal}};
 const context={TOOL_CATALOG:{[screen]:{name:screen,functions:fnName}},FUNCTION_PURPOSES:{},
  SENSITIVE:/password|secret|token/i,cleanText:(v,n)=>String(v==null?'':v).slice(0,n||500),
  inferFunctionPurpose:n=>n,selectorFor:()=>'',frameFor:()=>puzzleFrame,recentEvents:[],storeEvent:()=>{},
  global:{getComputedStyle:()=>({visibility:'visible',display:'block'})},Date,Function};
 vm.runInNewContext(describeFrame+';this.inspectFrame=describeFrame;',context);
 const result=context.inspectFrame(screen,frame,true,context.TOOL_CATALOG[screen]);
 assert.equal(result.function_api.length,1,screen+' function inventory');
 assert.equal(result.function_api[0].callable,true,screen+' callable flag');
 assert.ok(result.visible_text.length>0,screen+' visible text');
 const selected=result.function_api.find(item=>item.name===fnName&&item.callable);
 assert.ok(selected,'tool_call inventory must resolve '+screen+'.'+fnName);
 assert.equal(frameWindow[selected.name](),'called:'+screen);
}
console.log('PASS: callable function inventory and visible text verified for all seven tools.');
