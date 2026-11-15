const fs = require("node:fs");
const assert = require("node:assert/strict");

const read = (path) => fs.readFileSync(path, "utf8");
const admin = read("supabase/functions/quolab-nexus-admin/index.ts");
const ai = read("supabase/functions/quolab-nexus-ai/index.ts");
const sandbox = read("quolab_execution_sandbox.py");
const app = read("app.py");
const flask = read("quolab_nexus_server.py");
const config = read("quolab-nexus-supabase-config.js");
const requirements = read("requirements.txt");
const docker = read("Dockerfile");
const pages = read(".github/workflows/deploy-pages.yml");

assert.match(admin, /const origins = new Set/);
assert.match(admin, /MAX_BODY = 2_300_000/);
assert.match(admin, /async function readBody/);
assert.match(admin, /function rateLimited/);
assert.match(admin, /founderActions/);
assert.match(admin, /repo_is_founder/);
assert.match(admin, /secret\.startsWith\("sb_secret_"\)/);
assert.doesNotMatch(admin, /Access-Control-Allow-Origin["']\s*:\s*["']\*["']/);

assert.match(ai, /supabase\.auth\.getUser\(token\)/);
assert.match(ai, /user\.is_anonymous !== true/);
assert.match(ai, /withinRateLimit\(user\.id\)/);
assert.match(ai, /async function readLimitedText/);
assert.match(ai, /payload_too_large/);

assert.match(sandbox, /shutil\.which\("bwrap"\)/);
assert.match(sandbox, /--unshare-all/);
assert.match(sandbox, /--uid/);
assert.match(sandbox, /--gid/);
assert.match(sandbox, /os\\.readlink\\(path\\)/);
assert.match(sandbox, /--symlink/);
assert.match(sandbox, /--unshare-all/);
assert.match(sandbox, /no se ejecuta código sin aislamiento/);
assert.match(app, /execute_isolated\(code\)/);
assert.match(flask, /execute_isolated\(code\)/);
assert.doesNotMatch(app, /\bexec\s*\(/);
assert.doesNotMatch(flask, /\bexec\s*\(/);

assert.match(config, /sb_publishable_/);
assert.doesNotMatch(config, /sb_secret_|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(requirements, /^(<<<<<<<|=======|>>>>>>>)/m);
assert.match(docker, /bubblewrap/);
assert.match(docker, /USER 10001:10001/);
assert.match(pages, /path: dist/);
assert.match(pages, /cp quolab-nexus-\*\.js dist/);
assert.match(pages, /test ! -e dist\/quolab_execution_sandbox\.py/);

console.log("QuOLab Nexus security invariants passed.");
