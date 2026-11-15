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

console.log('PASS: exactly five specialists, central-owned general modules, and nested Quantum App Studio routing.');
