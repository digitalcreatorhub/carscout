// CarScout check that README.md has not gone stale. No network, no dependencies. Run: node tools/readmecheck.mjs
// It fails when:
//  - worker/worker.js answers an /api/... address that README.md does not mention;
//  - README.md names an /api/... address that the worker no longer answers;
//  - a file in tools/ or .github/workflows/ is not mentioned in README.md.
// This is the reason the README can be trusted: add a line to it whenever you add an address, a check or a workflow.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readme = read('README.md');
const worker = read('worker/worker.js');
const problems = [];

// addresses the worker answers: path === '/api/x' or u.pathname === '/api/x'
const routes = new Set();
for (const m of worker.matchAll(/(?:pathname|path)\s*===\s*'(\/api\/[a-z0-9\/_-]+)'/g)) routes.add(m[1]);
if (routes.size < 10) problems.push(`found only ${routes.size} addresses in worker/worker.js: the pattern in readmecheck.mjs no longer matches how routes are written`);
for (const r of routes) if (!readme.includes('`' + r + '`')) problems.push(`README.md does not mention ${r}`);

// addresses named in README.md (in `code` marks) that the worker does not answer
for (const m of readme.matchAll(/`(\/api\/[a-z0-9\/_-]+)`/g)) if (!routes.has(m[1])) problems.push(`README.md names ${m[1]}, but worker/worker.js does not answer it`);

// every check and workflow is described
const files = [
  ...fs.readdirSync(path.join(root, 'tools')).filter(f => f.endsWith('.mjs')).map(f => f.replace(/\.mjs$/, '')),
  ...fs.readdirSync(path.join(root, '.github/workflows')).filter(f => f.endsWith('.yml'))
];
for (const f of files) if (!readme.includes(f)) problems.push(`README.md does not mention ${f}`);

if (problems.length) {
  console.log('README check FAILED:\n' + problems.map(p => '- ' + p).join('\n'));
  process.exit(1);
}
console.log(`README check passed: ${routes.size} addresses, ${files.length} checks and workflows are described.`);
