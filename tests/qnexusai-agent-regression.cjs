const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('index.html','utf8');
const start = source.indexOf('  function inferAIContextTools(');
if (start < 0) throw new Error('inferAIContextTools missing');
let depth=0, end=-1, inString=null, escaped=false, lineComment=false, blockComment=false;
for(let i=start;i<source.length;i++){
  const c=source[i], n=source[i+1];
  if(lineComment){if(c==='\n')lineComment=false;continue;}
  if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++;}continue;}
  if(inString){if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c===inString)inString=null;continue;}
  if(c==='/'&&n==='/'){lineComment=true;i++;continue;}
  if(c==='/'&&n==='*'){blockComment=true;i++;continue;}
  if(c==='"'||c==="'"||c==='`'){inString=c;continue;}
  if(c==='{')depth++;
  if(c==='}'&&--depth===0){end=i+1;break;}
}
if(end<0)throw new Error('Could not isolate inferAIContextTools');
const fn=source.slice(start,end).replace(/^\s*function /,'function ');
const sandbox={AI_SCREENS:['projects','architect','architect-pro','nexus-connectors','help','quantum-puzzle','quantum-app-studio']};
vm.createContext(sandbox);vm.runInContext(fn+'; this.inferAIContextTools=inferAIContextTools;',sandbox);
const cases=[
 ['Abre Quantum Puzzle y dime el primer reto','quantum-puzzle'],
 ['crea una app en quantum app studio que simule ruido','quantum-app-studio'],
 ['configura un conector de IA','nexus-connectors'],
 ['ayuda: cómo funciona el notebook','architect-pro'],
 ['publica este proyecto','projects'],
 ['explica qué es un qubit','help'],
 ['resuelve el puzzle con un circuito de 3 qubits','quantum-puzzle'],
 ['open the studio and compile my app','quantum-app-studio'],
 ['añade una celda markdown al notebook con LaTeX','architect-pro'],
 ['how does the puzzle scoring work?','quantum-puzzle']
];
const screens=['home','architect','architect-pro','quantum-puzzle','help','projects'];
let total=0,passed=0,rows=[];
for(const [prompt,expected] of cases){
  for(const screen of screens){
    const got=sandbox.inferAIContextTools(prompt,{screen},0);
    const ok=got.includes(expected); total++;if(ok)passed++;
    rows.push({screen,prompt,expected,got,ok});
  }
}
const score=passed/total;
console.log(JSON.stringify({passed,total,score,failed:rows.filter(x=>!x.ok).slice(0,12)},null,2));
if(score<0.95)process.exitCode=1;
