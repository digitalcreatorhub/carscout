// Shared set-up of the offline checks (rate limits, database clean-up, page readers).
// No network and no secrets: worker/worker.js is loaded into a sandbox with a fixed clock, a fake `fetch` and a real
// SQLite database that behaves like Cloudflare D1 for the calls the worker makes. Node 22+ (node:sqlite).
// tools/lifecheck.mjs has its own copy of this set-up; it is left alone on purpose.
import vm from 'node:vm';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const DAY = 86400000;

/* a SQLite database behaving like Cloudflare D1 for the calls the worker makes */
export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => /^\s*(select|pragma)/i.test(sql) ? { results: db.prepare(sql).all(...args) } : { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }
  });
  return { raw: db, prepare: (sql) => wrap(sql), batch: async (st) => { db.exec('BEGIN'); try { const out = st.map(s => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

/* the worker in a sandbox. T.now is the clock (the test moves it); pages maps a URL to { status, body } for the fake fetch;
   calls lists every URL the worker tried to fetch (so a test can prove that nothing was fetched). */
export function loadWorker(opts = {}) {
  const T = { now: opts.now ?? Date.UTC(2026, 9, 1, 3, 0) };
  class FDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T.now); } static now() { return T.now; } }
  const pages = {}, calls = [];
  const fakeFetch = async (url) => { calls.push(String(url)); const p = pages[url] || { status: 404, body: '' }; return new Response(p.body, { status: p.status }); };
  const src = fs.readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8').replace('export default {', 'globalThis.__worker = {');
  const ctx = vm.createContext({ fetch: fakeFetch, URL, URLSearchParams, Request, Response, Headers, crypto, TextEncoder, TextDecoder, console, Date: FDate, setTimeout, clearTimeout, AbortSignal });
  vm.runInContext(src, ctx, { filename: 'worker.js' });
  const W = (code) => vm.runInContext(code, ctx);
  return { T, pages, calls, ctx, W };
}

/* a list of checks: check(condition, what, detail); finish() prints the result and sets the exit code */
export function checker(title) {
  const fails = [], oks = [];
  const check = (cond, what, detail) => { if (cond) oks.push(what); else fails.push(`${what}: ${detail === undefined ? 'failed' : JSON.stringify(detail)}`); };
  const finish = () => {
    console.log(oks.map(x => '✔ ' + x).join('\n'));
    if (fails.length) { console.log('\n' + fails.map(x => '✘ ' + x).join('\n')); console.log(`\n${title}: ${fails.length} failed, ${oks.length} passed`); process.exit(1); }
    console.log(`\n${title}: ${oks.length} checks passed`);
  };
  return { check, finish };
}
