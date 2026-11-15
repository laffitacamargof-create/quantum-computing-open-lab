const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('quolab-nexus-agent.js','utf8');
function extractFunction(text,name){
 const marker='function '+name+'(';
 const start=text.indexOf(marker);
 assert.ok(start>=0,'missing '+name);
 const brace=text.indexOf('{',start);
 let depth=0,quote='',escape=false;
 for(let i=brace;i<text.length;i++){
  const ch=text[i];
  if(quote){if(escape)escape=false;else if(ch==='\\\\')escape=true;else if(ch===quote)quote='';continue;}
  if(ch==='\\''||ch==='"'||ch==='\x60'){quote=ch;continue;}
  if(ch==='{')depth++;
  if(ch==='}'&&--depth===0)return text.slice(start,i+1);
 }
 throw new Error('unterminated '+name);
}
const describeFrame=extractFunction(source,'describeFrame');
const names=['getItems','reload','buildPalette','refreshApps','loadProjects','getHelp','getItems'];
const screens=['projects','architect','architect-pro','quantum-puzzle','quantum-app-studio','library','help'];
for(let i=0;i<screens.length;i++){
 const fnName=names[i];
 const frameWindow={[fnName]:function(){return 'called:'+screens[i];}};
 const body={innerText:'Visible '+screens[i]+' tool content'};
 const doc={readyState:'complete',documentElement:{},title:screens[i],body,activeElement:null,
  querySelectorAll:()=>[],defaultView:frameWindow};
 const frame={contentDocument:doc,getAttribute:(name)=>name==='src'?'/'+screens[i]+'.html':null};
 const context={TOOL_CATALOG:{[screens[i]]:{name:screens[i],functions:fnName}},
  FUNCTION_PURPOSES:{},SENSITIVE:/password|secret|token/i,cleanText:(v,n)=>String(v==null?'':v).slice(0,n||500),
  inferFunctionPurpose:n=>n,selectorFor:()=>'',frameFor:()=>null,recentEvents:[],global:{getComputedStyle:()=>({visibility:'visible',display:'block'})},Date,Function};
 vm.runInNewContext(describeFrame+';this.inspectFrame=describeFrame;',context);
 const result=context.inspectFrame(screens[i],frame,true,context.TOOL_CATALOG[screens[i]]);
 assert.equal(result.function_api.length,1,screens[i]+' function inventory');
 assert.equal(result.function_api[0].callable,true,screens[i]+' callable flag');
 assert.ok(result.visible_text.length>0,screens[i]+' visible text');
 const selected=result.function_api.find(item=>item.name===fnName&&item.callable);
 assert.ok(selected,'tool_call inventory must resolve '+screens[i]+'.'+fnName);
 assert.equal(frameWindow[selected.name](),'called:'+screens[i]);
}
console.log('PASS: describeFrame exposes callable function inventory and visible text for all seven tool modules.');
