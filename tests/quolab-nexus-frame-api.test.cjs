const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('quolab-nexus-agent.js','utf8');
function extractDeclaration(startMarker,endMarker){
 const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,'missing declaration '+startMarker);
 return source.slice(start,end);
}
const catalogContext={};
vm.runInNewContext(extractDeclaration('const TOOL_CATALOG = Object.freeze(','\n  const SAFE_FUNCTIONS')+';this.catalog=TOOL_CATALOG;',catalogContext);
const safeContext={};
vm.runInNewContext(extractDeclaration('const SAFE_FUNCTIONS = Object.freeze(','\n  const FUNCTION_PURPOSES')+';this.safe=SAFE_FUNCTIONS;',safeContext);
const start=source.indexOf('function describeFrame('),end=source.indexOf('\n  function snapshot(',start);
assert.ok(start>=0&&end>start,'describeFrame source must exist');
const describeFrame=source.slice(start,end);
const screens=['projects','architect','architect-pro','quantum-puzzle','quantum-app-studio','help'];
for(const screen of screens){
 const spec=catalogContext.catalog[screen],fnName=safeContext.safe[screen][0];
 assert.ok(spec&&fnName,'documented safe helper must exist for '+screen);
 const frameWindow={[fnName]:function(){return 'called:'+screen;}};
 const doc={readyState:'complete',documentElement:{},title:screen,body:{innerText:'Visible '+screen+' tool content'},activeElement:null,querySelectorAll:()=>[],defaultView:frameWindow};
 const frame={contentDocument:doc,getAttribute:(name)=>name==='src'?'/'+screen+'.html':null};
 const modal={classList:{contains:()=>true}};
 const puzzleFrame={contentDocument:{getElementById:()=>modal}};
 const context={TOOL_CATALOG:catalogContext.catalog,SAFE_FUNCTIONS:safeContext.safe,FUNCTION_PURPOSES:{},
  SENSITIVE:/password|secret|token/i,cleanText:(v,n)=>String(v==null?'':v).slice(0,n||500),
  inferFunctionPurpose:n=>n,selectorFor:()=>'',frameFor:()=>puzzleFrame,storeEvent:()=>{},
  global:{getComputedStyle:()=>({visibility:'visible',display:'block'})},Date,Function};
 vm.runInNewContext(describeFrame+';this.inspectFrame=describeFrame;',context);
 const result=context.inspectFrame(screen,frame,true,spec);
 assert.ok(result.function_api.length>0,screen+' must expose a function_api');
 assert.ok(result.visible_text.length>0,screen+' visible text');
 const selected=result.function_api.find(item=>item.name===fnName&&item.callable&&item.safe);
 assert.ok(selected,'tool_call must find a callable safe helper for '+screen);
 assert.equal(frameWindow[selected.name](),'called:'+screen);
}
console.log('PASS: all six active tool frames expose a callable safe function and visible text.');
