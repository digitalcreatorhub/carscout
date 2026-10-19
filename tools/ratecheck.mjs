// CarScout check of the request limits of the worker (worker/worker.js): one address may only make so many requests a minute,
// the limit never touches the pages and helpers that must always work, a limited request never reaches the car sites,
// and a broken limiter never locks people out. No network. Run: node tools/ratecheck.mjs   (Node 22+)
import { loadWorker, checker } from './lib/offline.mjs';

const { check, finish } = checker('rate limits');
const { T, ctx, calls, W } = loadWorker();
const ORIGIN = 'https://digitalcreatorhub.github.io';
const env = { ALLOW_ORIGIN: ORIGIN };               // no database: every answer is quick and needs no network
const exec = { waitUntil() { } };
const LIM = JSON.parse(W('JSON.stringify(RL_LIMIT)'));
const go = (path, ip, method = 'GET', e = env) => ctx.__worker.fetch(new Request('https://carscout.test' + path, { method, headers: ip ? { 'cf-connecting-ip': ip } : {}, ...(method === 'POST' ? { body: '{}' } : {}) }), e, exec);
const statuses = async (n, path, ip, method) => { const out = []; for (let k = 0; k < n; k++) out.push((await go(path, ip, method)).status); return out; };

check(LIM.read >= 100 && LIM.write >= 20 && LIM.tick >= LIM.read, 'the limits are generous enough for people: one check of a car is about 20 requests', LIM);

/* ---- reading: the budget of one address ---- */
const first = await statuses(LIM.read, '/api/memory', '1.1.1.1');
check(first.every(s => s === 200), `the first ${LIM.read} requests of an address in a minute are answered`, first.filter(s => s !== 200).length);
const over = await go('/api/memory', '1.1.1.1');
const body = await over.json();
check(over.status === 429 && body.ok === false && body.error === 'rate_limited', 'the next one is refused with 429 and a clear error', { status: over.status, body });
check(+over.headers.get('retry-after') >= 1 && +over.headers.get('retry-after') <= 60 && body.retryAfter === +over.headers.get('retry-after'), 'the answer says how many seconds to wait (Retry-After)', over.headers.get('retry-after'));
check(over.headers.get('access-control-allow-origin') === ORIGIN, 'the refusal carries the CORS header, so the page can read it and show the message', over.headers.get('access-control-allow-origin'));
check(/Слишком много/.test(body.message) && /Too many/.test(body.message), 'the message is written in Russian and English (the page shows it as it is)', body.message);
check((await go('/api/memory', '2.2.2.2')).status === 200, 'another address is not affected');

/* ---- a refused request never reaches the car sites ---- */
const before = calls.length;
const lst = await go('/api/listing?url=' + encodeURIComponent('https://www.ss.com/msg/ru/transport/cars/audi/a6/abcdef.html'), '1.1.1.1');
check(lst.status === 429 && calls.length === before, 'a refused listing request fetches nothing from ss.com', { status: lst.status, fetched: calls.length - before });
const ok = await go('/api/listing?url=' + encodeURIComponent('https://www.ss.com/msg/ru/transport/cars/audi/a6/abcdef.html'), '3.3.3.3');
check(ok.status !== 429 && calls.length === before + 1, 'an allowed one does (so the test above proves something)', { status: ok.status, fetched: calls.length - before });

/* ---- the minute is over: the counter starts again ---- */
T.now += 61000;
check((await go('/api/memory', '1.1.1.1')).status === 200, 'a minute later the address may ask again');

/* ---- what is never limited ---- */
await statuses(LIM.read + 5, '/api/memory', '4.4.4.4');
check((await go('/api/memory', '4.4.4.4')).status === 429, 'address 4.4.4.4 is over its budget (set-up of the next checks)');
check((await go('/', '4.4.4.4')).status === 200, 'the status page works even over the budget');
check((await go('/api/push/key', '4.4.4.4')).status === 200, 'the public key for phone notifications works even over the budget');
check((await go('/api/memory', '4.4.4.4', 'OPTIONS')).status === 204, 'the browser preflight (OPTIONS) is never limited');
check((await statuses(LIM.read * 3, '/', '4.4.4.4')).every(s => s === 200), 'the status page can be opened any number of times');

/* ---- reading, writing and the cron helpers have separate budgets ---- */
const posts = await statuses(LIM.write, '/api/watch?code=bad', '4.4.4.4', 'POST');
check(posts.every(s => s === 400), `an address over its reading budget can still save (${LIM.write} writes go through; the bad code is answered with 400, not 429)`, posts);
check((await go('/api/watch?code=bad', '4.4.4.4', 'POST')).status === 429, 'writes have their own, smaller budget');
const ticks = await statuses(LIM.tick, '/api/alive/tick', '5.5.5.5');
check(ticks.every(s => s === 200) && (await go('/api/alive/tick', '5.5.5.5')).status === 429, `the helpers called by GitHub (ticks) get ${LIM.tick} a minute, then 429`);
check((await go('/api/push/tick', '5.5.5.5')).status === 429 && (await go('/api/memory', '5.5.5.5')).status === 200, 'both tick paths share the tick budget, and ticks do not use up the reading budget');

/* ---- normal use is not limited ---- */
let worst = 0;
for (let check1 = 0; check1 < 5; check1++) for (let k = 0; k < 20; k++) { const s = (await go('/api/memory', '6.6.6.6')).status; if (s === 429) worst++; }
check(worst === 0, 'five car checks in a minute (100 requests) are not limited', worst);

/* ---- no address (a test or an internal call) is never limited ---- */
check((await statuses(LIM.read * 2, '/api/memory', null)).every(s => s === 200), 'a request without an address is not counted');

/* ---- many addresses at once do not make the memory grow ---- */
for (let k = 0; k < 2600; k++) await go('/api/memory', '10.1.' + (k >> 8) + '.' + (k & 255));
check(W('RL_MEM.size') <= W('RL_MAX_KEYS'), 'the counters are bounded in size', W('RL_MEM.size'));
check((await go('/api/memory', '10.9.9.9')).status === 200, 'after many addresses a new one is still answered');

/* ---- the optional Cloudflare Rate Limiting binding (RATE) ---- */
const seen = [];
const bound = { ALLOW_ORIGIN: ORIGIN, RATE: { limit: async ({ key }) => { seen.push(key); return { success: !key.endsWith('|9.9.9.9') }; } } };
check((await go('/api/memory', '9.9.9.9', 'GET', bound)).status === 429, 'if the binding says no, the request is refused');
check((await go('/api/memory', '8.8.8.8', 'GET', bound)).status === 200 && seen.includes('read|8.8.8.8'), 'if it says yes, the request is answered, and the key has the kind and the address', seen);
const broken = { ALLOW_ORIGIN: ORIGIN, RATE: { limit: async () => { throw new Error('binding down'); } } };
check((await go('/api/memory', '7.7.7.7', 'GET', broken)).status === 200, 'a binding that fails never locks people out');
check((await go('/api/memory', '7.7.7.7', 'GET', { ALLOW_ORIGIN: ORIGIN, RATE: {} })).status === 200, 'a binding without limit() is ignored');

finish();
