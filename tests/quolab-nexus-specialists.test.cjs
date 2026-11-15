const assert = require('node:assert/strict');
const fs = require('node:fs');

const agent = fs.readFileSync('quolab-nexus-agent.js', 'utf8');
const connector = fs.readFileSync('quolab-nexus-tool-connector.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const puzzle = fs.readFileSync('quolab-nexus-quantum-puzzle.html', 'utf8');
const appStudio = fs.readFileSync('quolab-nexus-app-studio.html', 'utf8');

const registry = agent.match(/const TOOL_SPECS = Object\.freeze\(\{([\s\S]*?)\}\);/);
assert.ok(registry, 'specialist registry must exist');
const keys = [...registry[1].matchAll(/^\s*(['"]?[a-z][a-z-]*['"]?)\s*:/gm)].map(m => m[1].replace(/['"]/g, ''));
assert.deepEqual(keys, ['projects', 'architect', 'architect-pro', 'quantum-puzzle', 'quantum-app-studio']);
assert.equal(keys.length, 5, 'exactly five specialists are allowed');

for (const name of [
  'Projects Specialist',
  'Quantum Open Lab Specialist',
  'Quantum Notebook Specialist',
  'Quantum Puzzle Specialist',
  'Quantum App Studio Specialist'
]) assert.ok(registry[1].includes(name), name + ' must be registered');

assert.match(agent, /CENTRAL_SCREENS = Object\.freeze\(\['library','help'\]\)/);
assert.match(agent, /SPECIALIST_INSTRUCTIONS = Object\.freeze/);
for (const role of [
  'You are the Projects Specialist',
  'You are the Quantum Open Lab Specialist',
  'You are the Quantum Notebook Specialist',
  'You are the Quantum Puzzle Specialist',
  'You are the Quantum App Studio Specialist'
]) assert.ok(agent.includes(role), role + ' must have its own worker instructions');
assert.match(agent, /const VERSION = '1\.2\.1'/);
assert.match(agent, /AIza|xox\[baprs\]/);
assert.match(connector, /const VERSION = '1\.2\.1'/);
assert.match(connector, /AIza\|xox\[baprs\]/);
assert.match(agent, /getSpecialistInstructions: id => SPECIALIST_INSTRUCTIONS\[id\]/);
assert.match(agent, /recordDelegation,/);
assert.match(agent, /quolab:nexus-alert/);
assert.match(index, /function bindProactiveAlerts\(\)/);
assert.match(index, /Automatic tool incident/);
assert.match(index, /PROACTIVE INCIDENT MODE/);
assert.match(index, /Diagnose the likely cause/);
assert.match(index, /He detectado un problema en/);
assert.match(index, /I detected a problem in/);
assert.match(index, /bindProactiveAlerts\(\)/);
assert.match(agent, /SPECIALIST_INSTRUCTIONS/);
assert.match(agent, /operation === 'drag'/);
assert.match(agent, /operation === 'hover'/);
assert.match(agent, /operation === 'key'/);
assert.match(connector, /MutationObserver/);
assert.match(connector, /output_change/);
assert.match(index, /'click','fill','type','select','scroll','hover','key','drag'/);
assert.match(index, /async function routeAI\(msg, ctx\)/);
assert.match(index, /function isAIAvailable\(\)/, 'server-side gateway must count as configured without a browser API key');
assert.equal((index.match(/if \(isAIAvailable\(\)\)/g) || []).length, 2, 'AI status and send flow must use the same availability check');
assert.match(index, /Interpret short follow-ups from recent conversation history/, 'short follow-ups must retain conversational intent');
assert.match(index, /QuOLab AI gateway HTTP /, 'gateway failures must expose safe provider diagnostics');
assert.match(index, /QUOLAB NEXUS AI/);
assert.match(agent, /specialist_runs: delegationRuns\.slice\(-8\)/);
assert.match(index, /async function routeAI\(msg, ctx\)/, 'central router must dispatch real worker calls');
assert.match(index, /SPECIALIST WORKER MODE/);
assert.match(index, /recordDelegation\(route\.specialist, 'completed'/);
assert.match(index, /recordDelegation\(route\.specialist, 'failed'/);
assert.match(index, /async function callAI\(msg, ctx, options = \{\}\)/);

assert.match(agent, /QuOLab Nexus AI — central coordinator/);
assert.match(agent, /getElementById\('studioIframe'\)/, 'App Studio must be reachable through its nested iframe');
assert.match(agent, /studioModalReal/, 'App Studio activation must be detected');

assert.match(connector, /'quolab-nexus-app-studio\.html': 'quantum-app-studio'/);
assert.match(connector, /nested_tool_event/);
assert.match(connector, /includes\('quolab-nexus-app-studio\.html'\)/);
assert.match(puzzle, /id="studioIframe"[^>]+src="quolab-nexus-app-studio\.html"/);
assert.match(appStudio, /<script defer src="quolab-nexus-tool-connector\.js"><\/script>/);

assert.match(index, /AI_SCREENS = \[[^\]]*'quantum-app-studio'\]/);
assert.match(index, /AI_NAV_SCREENS = AI_SCREENS\.filter\(screen => screen !== 'quantum-app-studio'\)/);
assert.match(index, /5 tool specialists/);
assert.match(index, /exactly five tool specialists and no others/);
assert.match(index, /Library and Help are central-agent responsibilities/);
assert.match(index, /same language as the user's latest message/);

assert.match(index, /SPECIALIST WORKER MODE/);
assert.match(index, /operation":"click\|fill\|type\|select\|scroll\|hover\|key\|drag/);
assert.match(index, /QUOLAB NEXUS AI/);
console.log('PASS: five specialist workers, central dispatch, telemetry, UI actions and nested App Studio routing.');
