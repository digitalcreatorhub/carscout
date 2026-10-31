// CarScout check of the "how long cars stay on sale" logic (worker/worker.js) against a real SQLite database.
// No network: the ss.com pages are replaced by fixed test pages, and the clock is set by the test.
// It checks: the database upgrade, which ads count (only those born while we were watching), the "is it gone" check
// (a removed page must look removed twice), reposts counted as one sale, and the survival numbers (Kaplan-Meier).
// Run: node tools/lifecheck.mjs   (Node 22+)
import vm from 'node:vm';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const fails = [], oks = [];
const check = (cond, what, detail) => { if (cond) oks.push(what); else fails.push(`${what}: ${detail === undefined ? 'failed' : JSON.stringify(detail)}`); };

const DAY = 86400000;
const T = { now: Date.UTC(2026, 9, 1, 3, 0) };
const T0 = T.now;
class FDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T.now); } static now() { return T.now; } }
const pages = {};
const fakeFetch = async (url) => { const p = pages[url] || { status: 404, body: '' }; return new Response(p.body, { status: p.status }); };

/* a SQLite database behaving like Cloudflare D1 for the calls the worker makes */
function makeD1() {
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

const src = fs.readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8').replace('export default {', 'globalThis.__worker = {');
const ctx = vm.createContext({ fetch: fakeFetch, URL, URLSearchParams, Request, Response, Headers, crypto, TextEncoder, TextDecoder, console, Date: FDate, setTimeout, clearTimeout, AbortSignal });
vm.runInContext(src, ctx, { filename: 'worker.js' });
const W = (code) => vm.runInContext(code, ctx);
const DB = makeD1(); ctx.env = { DB, ALLOW_ORIGIN: '*' };
const q = (sql, ...a) => DB.raw.prepare(sql).all(...a);

const catUrl = (cat, id) => `https://www.ss.com/msg/ru/transport/cars/${cat}/${id}.html`;
const aliveHtml = '<html><td class="ads_opt_name">Marka</td><td class="ads_price">9 000 €</td></html>';
const removedHtml = '<html>' + 'x'.repeat(3000) + '</html>';

/* ---------- 1. an old database is upgraded without losing anything ---------- */
DB.raw.exec("CREATE TABLE ads(id TEXT PRIMARY KEY, src TEXT, mk TEXT, md TEXT, yr INT, vin TEXT, seller TEXT, title TEXT, ft INT, fp INT, fkm INT, lt INT, lp INT, lkm INT, n INT DEFAULT 1, gone INT, posted TEXT)");
DB.raw.exec("INSERT INTO ads(id, src, mk, md, yr, title, ft, fp, fkm, lt, lp, lkm) VALUES('ss:old01', 'ss', 'volkswagen', 'golf', 2015, 'Golf old', 1, 9000, 150000, 1, 9000, 150000)");
check(await W('memInit(env)'), 'the database opens');
const cols = q('PRAGMA table_info(ads)').map(c => c.name);
check(['u', 'cat', 'ck', 'gc'].every(c => cols.includes(c)), 'new columns added to the old table', cols);
check(q("SELECT COUNT(*) AS n FROM ads WHERE id = 'ss:old01'")[0].n === 1, 'the old ad is still there');
check(q("SELECT name FROM sqlite_master WHERE name = 'trk'").length === 1, 'the tracking table exists');

/* ---------- 2. saving a whole category list starts watching that category ---------- */
const items = (cat, n, ids) => Array.from({ length: n }, (_, k) => ({ url: catUrl(cat, ids ? ids[k] : 'a' + k + 'bcd'), price: 9000 + k * 100, km: 150000, year: 2015, title: 'Golf 1.6 TDI ' + k }));
await W(`memSave(env, memRowsFromItems(${JSON.stringify(items('volkswagen/golf-7', 6))}, 'Volkswagen', 'Golf', 'ss'))`);
const trk = q('SELECT cat, t FROM trk');
check(trk.length === 1 && trk[0].cat === 'volkswagen/golf-7' && trk[0].t === T0, 'a list of 6 ads starts watching its category', trk);
const a0 = q("SELECT u, cat FROM ads WHERE id = 'ss:a0bcd'")[0];
check(a0 && a0.cat === 'volkswagen/golf-7' && /golf-7\/a0bcd\.html$/.test(a0.u), 'the ad address and category are stored', a0);
await W(`memSave(env, memRowsFromItems(${JSON.stringify(items('audi/a6', 1, ['zzz11']))}, 'Audi', 'A6', 'ss'))`);
check(q("SELECT COUNT(*) AS n FROM trk").length === 1 && q('SELECT COUNT(*) AS n FROM trk')[0].n === 1, 'a single ad does not start watching a category');
await W(`memSave(env, memRowsFromItems(${JSON.stringify([{ url: catUrl('volkswagen/golf', 'old01'), price: 9000, km: 150000, year: 2015, title: 'Golf old' }])}, 'Volkswagen', 'Golf', 'ss'))`);
check(q("SELECT u FROM ads WHERE id = 'ss:old01'")[0].u != null, 'an ad saved before the upgrade gets its address when seen again');
check(W("ssCat('https://www.ss.com/msg/ru/transport/cars/others/abcd.html')") === null, 'ads under "others" have no category');

/* ---------- 3. the "is it still there" check ---------- */
DB.raw.exec("DELETE FROM ads WHERE id IN ('ss:old01', 'ss:zzz11')");
T.now = T0 + 5 * DAY;
for (let k = 0; k < 6; k++) pages[catUrl('volkswagen/golf-7', 'a' + k + 'bcd')] = { status: 200, body: aliveHtml };
pages[catUrl('volkswagen/golf-7', 'a1bcd')] = { status: 200, body: removedHtml };   // looks removed
pages[catUrl('volkswagen/golf-7', 'a2bcd')] = { status: 404, body: '' };            // removed
pages[catUrl('volkswagen/golf-7', 'a3bcd')] = { status: 403, body: 'denied' };      // the site refused us
let r = await W('aliveTick(env, true)');
check(r.checked === 5 && r.alive === 2 && r.first === 2 && r.unknown === 1, 'first check: 2 alive, 2 look removed (first look), 1 refused', r);
check(q("SELECT COUNT(*) AS n FROM ads WHERE gone IS NOT NULL")[0].n === 0, 'nothing is called gone after one look');
const alive = q("SELECT lt FROM ads WHERE id = 'ss:a0bcd'")[0];
check(alive.lt === T.now, 'an ad found alive is marked seen now', alive);
T.now += 30 * 60000;
r = await W('aliveTick(env, true)');
check(r.checked === 1 && r.alive === 1, 'the next check takes the ad not checked yet, not the ones just checked', r);
T.now += 40 * 60000;                                                                // 70 minutes after the first look
r = await W('aliveTick(env, true)');
check(r.gone === 2 && r.unknown === 1, 'a second look an hour later confirms the removed ads', r);
const g = q("SELECT id, gone FROM ads WHERE gone IS NOT NULL ORDER BY id");
check(g.length === 2 && g.every(x => x.gone === T0 + 5 * DAY), 'the gone time is the first time it looked removed', g);
T.now += 5 * 60000;
r = await W('aliveTick(env, true)');
check(r.skipped === undefined && (r.idle || r.checked === 0 || r.checked === undefined), 'nothing is checked again at once', r);
r = await W('aliveTick(env, false)');
check(r.skipped === true || r.idle === true, 'two quick calls do not hammer the site', r);
/* a page that looked removed once and alive the next time is not gone */
DB.raw.exec("UPDATE ads SET gone = NULL, gc = NULL, ck = NULL, lt = " + (T.now - 6 * DAY) + " WHERE id = 'ss:a2bcd'");
pages[catUrl('volkswagen/golf-7', 'a2bcd')] = { status: 404, body: '' };
T.now += 61 * 60000; await W('aliveTick(env, true)');
pages[catUrl('volkswagen/golf-7', 'a2bcd')] = { status: 200, body: aliveHtml };
T.now += 61 * 60000; r = await W('aliveTick(env, true)');
const a2 = q("SELECT gone, gc FROM ads WHERE id = 'ss:a2bcd'")[0];
check(a2.gone === null && a2.gc === null, 'an ad that comes back is not gone', a2);
/* the check must not read the old ads of other sites again on every run (the free D1 plan allows 5 million rows read a day) */
const planAlive = q("EXPLAIN QUERY PLAN SELECT id, u, gc FROM ads INDEXED BY ads_alive_ss WHERE gone IS NULL AND src = 'ss' AND u IS NOT NULL AND lt < 1 AND (ck IS NULL OR ck < 1) ORDER BY lt LIMIT 5");
check(q("SELECT name FROM sqlite_master WHERE name = 'ads_alive_ss'").length === 1 && /ads_alive_ss/.test(JSON.stringify(planAlive)), 'the "is it still there" pick reads only ss.com ads with an address, through its own small index', planAlive);

/* ---------- 4. survival numbers ---------- */
const obs = [3, 5, 5, 8, 12, 12, 15, 20, 22, 30].map(t => ({ t, ev: true })).concat([7, 9, 14, 18, 25, 28, 35, 40, 45, 50].map(t => ({ t, ev: false })));
const naive = (o) => { const ts = [...new Set(o.filter(x => x.ev).map(x => x.t))].sort((a, b) => a - b); let S = 1; return ts.map(t => { S *= 1 - o.filter(x => x.ev && x.t === t).length / o.filter(x => x.t >= t).length; return [t, S]; }); };
const curve = naive(obs), medN = curve.find(p => p[1] <= 0.5)[0], s30 = curve.filter(p => p[0] <= 30).pop()[1];
const km = W(`kmCurve(${JSON.stringify(obs)})`);
check(km.events === 10 && km.n === 20, 'survival: counts', km);
check(km.med === medN, 'survival: the median matches an independent calculation', [km.med, medN]);
check(km.p30 === Math.round((1 - s30) * 100), 'survival: share gone within 30 days matches', [km.p30, Math.round((1 - s30) * 100)]);
check(W(`kmCurve(${JSON.stringify(obs.slice(0, 3))})`).p30 === null, 'survival: too few cars still watched gives no number');
const naiveWrong = obs.filter(o => o.ev).map(o => o.t).sort((a, b) => a - b); const wrongMed = naiveWrong[naiveWrong.length >> 1];
check(km.med > wrongMed, 'counting cars still on sale makes the time longer than counting only the ones that left', [km.med, wrongMed]);

/* ---------- 5. which ads count, reposts, price groups ---------- */
const row = (o) => Object.assign({ id: 'x', yr: 2015, fp: 9000, lp: 9000, fkm: 150000, ft: T0 + 3 * DAY, lt: T0 + 10 * DAY, gone: null, posted: null, cat: 'a/b', title: 't' }, o);
const trkMap = { 'a/b': T0 };
let ls = W(`lifeStats(${JSON.stringify([row({ id: 'first-day', ft: T0, lt: T0 + 9 * DAY, gone: T0 + 9 * DAY }), row({ id: 'late', ft: T0 + 3 * DAY, lt: T0 + 13 * DAY, gone: T0 + 15 * DAY }), row({ id: 'posted-old', posted: '2026-09-01', ft: T0 + 4 * DAY, lt: T0 + 9 * DAY, gone: T0 + 9 * DAY }), row({ id: 'nocat', cat: null, ft: T0 + 5 * DAY, lt: T0 + 9 * DAY, gone: T0 + 9 * DAY })])}, ${JSON.stringify(trkMap)}, ${T0 + 30 * DAY})`);
check(ls.n === 1 && ls.events === 1, 'only the ad born while watching counts (not first-day, not posted before, not uncategorised)', ls);
ls = W(`lifeStats(${JSON.stringify([row({ id: 'A', title: 'Golf 1.6', ft: T0 + 3 * DAY, lt: T0 + 18 * DAY, gone: T0 + 20 * DAY }), row({ id: 'B', title: 'Golf 1.6', ft: T0 + 21 * DAY, lt: T0 + 38 * DAY, gone: T0 + 40 * DAY })])}, ${JSON.stringify(trkMap)}, ${T0 + 60 * DAY})`);
check(ls.n === 1 && ls.events === 1, 'an ad that left and came back as the same car is one sale', ls);
ls = W(`lifeStats(${JSON.stringify([row({ id: 'A', title: 'Golf 1.6', ft: T0 + 3 * DAY, lt: T0 + 18 * DAY, gone: T0 + 20 * DAY }), row({ id: 'B', title: 'Golf 1.6 other', ft: T0 + 21 * DAY, lt: T0 + 38 * DAY, gone: T0 + 40 * DAY })])}, ${JSON.stringify(trkMap)}, ${T0 + 60 * DAY})`);
check(ls.n === 2 && ls.events === 2, 'different text means a different car', ls);

/* a market: cheap cars go fast, dear ones slowly; nothing is shown until there are enough sales */
const rows = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let k = 0; k < 90; k++) {
  const grp = k % 3, mean = [8, 22, 60][grp], price = [8300, 9000, 9900][grp] + Math.round(rnd() * 100);
  const life = -Math.log(1 - rnd()) * mean, born = 3 + rnd() * 30, left = born + life, watchedUntil = 75;
  const gone = left <= watchedUntil;
  rows.push(row({ id: 'm' + k, title: 'g' + k, fkm: 100000 + k * 1000, fp: price, lp: price, ft: T0 + Math.round(born * DAY), lt: T0 + Math.round((gone ? Math.max(born, left - 1) : watchedUntil) * DAY), gone: gone ? T0 + Math.round(left * DAY) : null }));
}
ls = W(`lifeStats(${JSON.stringify(rows)}, ${JSON.stringify(trkMap)}, ${T0 + 75 * DAY})`);
check(ls.n === 90 && ls.events >= 8 && ls.days > 0, 'a model with enough sales gets a median', ls);
check(ls.groups && ls.groups.cheap && ls.groups.dear && ls.groups.cheap.days < ls.groups.mid.days && ls.groups.mid.days < ls.groups.dear.days, 'cheaper than similar cars sells faster than dearer', ls.groups);
check(ls.since === 75, 'it says for how many days the category has been watched', ls.since);
const few = W(`lifeStats(${JSON.stringify(rows.slice(0, 6))}, ${JSON.stringify(trkMap)}, ${T0 + 75 * DAY})`);
check(few.days === undefined && few.p30 === undefined && !few.groups, 'with fewer than 8 sales no figure is shown', few);

/* ---------- 6. the memory answer of the worker ---------- */
DB.raw.exec("DELETE FROM ads; DELETE FROM trk;");
DB.raw.exec(`INSERT INTO trk(src, cat, t) VALUES('ss', 'a/b', ${T0})`);
const ins = DB.raw.prepare("INSERT INTO ads(id, src, mk, md, yr, title, ft, fp, fkm, lt, lp, lkm, n, gone, cat) VALUES(?, 'ss', 'volkswagen', 'golf', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'a/b')");
rows.forEach(x => ins.run(x.id, x.yr, x.title, x.ft, x.fp, x.fkm, x.lt, x.lp, x.fkm, x.gone));
const res = await (await W("__worker.fetch(new Request('https://w.test/api/memory?make=Volkswagen&model=Golf&year=2015'), env, { waitUntil() {} })")).json();
check(res.ok && res.market && res.market.sold === ls.events && res.market.days === ls.days && res.market.tracked === 90, 'the memory answer carries the measured numbers', res.market);

/* ---------- 7. what the app says about it (the real functions are cut out of index.html) ---------- */
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const line = re => { const m = html.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
  const a = html.indexOf('function memPhrase'), z = html.indexOf('function pMem');
  check(a > 0 && z > a, 'the text functions are found in index.html');
  const code = [line(/^function L\(ru,en,lv\)\{.*$/m), line(/^function nDays\(n\)\{.*$/m), line(/^function dayDiff\(iso\)\{.*$/m), line(/^function isAbroad\(c\)\{.*$/m), html.slice(a, z)].join('\n');
  const run = (lang, mk, v) => { const c = vm.createContext({ S: { lang }, lvT: x => x, console }); vm.runInContext(code, c); c.mk = mk; c.v = v; return vm.runInContext('memMarketLines(mk, v)', c); };
  const ago = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
  const mk = { n: 88, events: 71, since: 75, days: 17.4, p14: 49, p30: 68, p60: 86, drop: -4.2, groups: { cheap: { days: 6, p30: null }, mid: { days: 17.4 }, dear: { days: 57.1 } } };
  const buy = (delta, posted, cc) => ({ car: { cc: cc || 'LV', posted }, ver: { delta } });
  let l = run('ru', mk, buy(0, ago(15)));
  check(l.length === 2 && /примерно за 17 дней \(медиана; цену перед уходом снижали в среднем на 4%\)/.test(l[0]) && /из 88 объявлений под наблюдением CarScout ушло 71/.test(l[0]) && /наблюдение идёт 75 дней/.test(l[0]), 'buying: the typical time, the price cut and the size of the sample are said', l);
  l = run('ru', mk, buy(10, ago(15)));
  check(l.length === 2 && /^Объявления дороже похожих уходят с сайта за ~57 дней\. Для сравнения: дешевле похожих — за ~6 дней; по цене рынка — за ~17 дней\.$/.test(l[1]), 'buying a dear ad: its own group first, the others for comparison', l);
  l = run('ru', mk, buy(-10, ago(15)));
  check(/^Объявления дешевле похожих уходят с сайта за ~6 дней/.test(l[1]), 'buying a cheap ad: the cheap group', l);
  l = run('ru', mk, buy(0, ago(60)));
  check(l.some(x => /висит 6[01] (?:дней|день), а типичный срок — 17 дней: оно засиделось/.test(x)), 'an ad on sale twice as long as typical is called stale (a bargaining argument)', l);
  l = run('ru', mk, buy(0, ago(3)));
  check(l.some(x => /свежее \(3 дня при типичных 17 днях?\)|свежее \(3 дня при типичных 17 дней\)/.test(x)), 'a fresh ad is called fresh', l);
  l = run('ru', mk, buy(12, ago(60), 'DE'));
  check(l.length === 1, 'a car on sale abroad gets only the general Latvian line, no price group and no stale claim', l);
  l = run('ru', mk, { sell: {}, car: {} });
  check(l.length === 2 && /^Срок зависит от цены: дешевле похожих — за ~6 дней; по цене рынка — за ~17 дней; дороже похожих — за ~57 дней\.$/.test(l[1]), 'selling: all three price groups are listed', l);
  l = run('ru', { n: 40, events: 9, since: 20, p14: 35 }, buy(0, null));
  check(l.length === 1 && /За 14 дней уходит около 35%|за 14 дней уходит около 35%/.test(l[0]), 'when the median is not known yet, the share that left is said instead', l);
  l = run('ru', { n: 30, events: 3, since: 10 }, buy(0, null));
  check(l.length === 0, 'with too few sales nothing is shown', l);
  for (const lang of ['en', 'lv']) {
    const t = run(lang, mk, buy(10, ago(60))).join(' | ');
    check(t.length > 100 && !/undefined|NaN|null/.test(t), lang + ': the lines are complete', t);
  }
}

/* ---------- 8. BETA: price-drop arrows, the start-of-sale line, the cost of the trip (pure functions cut out of index.html) ---------- */
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const line = re => { const m = html.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
  const pa = html.indexOf('/*BETA-PURE-START*/'), pz = html.indexOf('/*BETA-PURE-END*/');
  const ua = html.indexOf('function dropBadge'), uz = html.indexOf('function dropPlace'), ta = html.indexOf('function tripLine'), tz = html.indexOf('function tripRecalc');
  check(pa > 0 && pz > pa && uz > ua && ua > pz && tz > ta, 'the beta functions are found in index.html');
  const code = [line(/^function esc\(s\)\{.*$/m), line(/^function L\(ru,en,lv\)\{.*$/m), line(/^function fmt\(n\)\{.*$/m), line(/^function eur\(n\)\{.*$/m), line(/^function pct\(d\)\{.*$/m), line(/^function memDate\(t\)\{.*$/m),
    html.slice(pa, pz), html.slice(ua, uz), html.slice(ta, tz)].join('\n');
  const mkctx = (lang) => { const c = vm.createContext({ S: { lang }, lvT: x => x, console }); vm.runInContext(code, c); return c; };
  const ru = mkctx('ru');
  const J = (c, expr) => JSON.parse((vm.runInContext('JSON.stringify(' + expr + ')', c) || 'null').replace(/[  ]/g, ' '));
  const now = new Date(2026, 9, 16, 19, 0).getTime(), at = (days, h = 12) => new Date(2026, 9, 16 - days, h, 0).getTime();
  const rd = (hist) => J(ru, `recentDrop(${JSON.stringify(hist)}, ${now})`);

  /* arrows: only a drop seen within the last 5 days, and not one that went back up */
  let d = rd([{ t: at(9), p: 10000 }, { t: at(1), p: 9700 }]);
  check(d && d.from === 10000 && d.to === 9700 && d.steps === 1, 'a drop one day ago is shown', d);
  check(rd([{ t: at(12), p: 10000 }, { t: at(8), p: 9700 }]) === null, 'a drop eight days ago is NOT shown');
  check(rd([{ t: at(12), p: 10000 }, { t: at(6), p: 9700 }]) === null, 'a drop six days ago is NOT shown (the window is 5 days)');
  check(rd([{ t: at(9), p: 10000 }, { t: at(4), p: 9700 }]) !== null, 'a drop four days ago is shown');
  check(rd([{ t: at(9), p: 10000 }, { t: at(3), p: 9700 }, { t: at(1), p: 9900 }]) === null, 'a drop followed by a rise is not shown as a drop');
  check(rd([{ t: at(2), p: 9000 }, { t: at(1), p: 9300 }]) === null, 'a rise is not shown as a drop');
  d = rd([{ t: at(9), p: 10000 }, { t: at(3), p: 9800 }, { t: at(1), p: 9500 }]);
  check(d && d.from === 10000 && d.to === 9500 && d.steps === 2, 'two drops inside the window are added up', d);
  d = rd([{ t: at(10), p: 10000 }, { t: at(8), p: 9800 }, { t: at(1), p: 9500 }]);
  check(d && d.from === 9800 && d.steps === 1, 'a drop older than the window is not counted in the total', d);
  check(rd([{ t: at(1), p: 9500 }]) === null && rd([]) === null && rd(null) === null, 'one price point or none: nothing is shown');
  check(rd([{ t: at(1), p: 9500 }, { t: at(0), p: 9500 }]) === null, 'the same price seen twice is not a change');
  const wn = (hist, price) => J(ru, `recentDrop(histWithNow(${JSON.stringify(hist)}, ${price}, ${now}), ${now})`);
  d = wn([{ t: at(9), p: 10000 }], 9600);
  check(d && d.from === 10000 && d.to === 9600, 'if the page shows a lower price than the memory knows, that drop is seen now', d);
  check(wn([{ t: at(9), p: 10000 }], 10000) === null && wn([{ t: at(9), p: 10000 }], 10400) === null, 'same or higher price than the memory: no arrow');

  /* the start-of-sale line */
  const st = (posted, first, price) => J(ru, `adStart(${JSON.stringify(posted)}, ${JSON.stringify(first)}, ${price}, ${now})`);
  let s = st('2026-10-05', { t: at(10), p: 9500 }, 9200);
  check(s.start === 9500 && s.exact === true && s.now === 9200, 'seen within 2 days of posting: it is the start price', s);
  s = st('2026-10-05', { t: at(4), p: 9500 }, 9200);
  check(s.start === 9500 && s.exact === false, 'seen long after posting: it is only the first price CarScout saw', s);
  s = st('2026-10-05', { t: at(0, 8), p: 9500 }, 9500);
  check(s.start === null, 'seen only today: nothing to compare with', s);
  s = st(null, { t: at(5), p: 9500 }, 9200);
  check(s.posted === null && s.exact === false && s.start === 9500, 'no posting date: never called the start price', s);
  s = st('2026-10-05', { t: at(10), p: 9500 }, 9200);
  const sl = (lang, x) => J(mkctx(lang), `startLine(${JSON.stringify(x)})`);
  check(sl('ru', s) === 'В продаже с 05.10.2026 · цена в начале продажи 9 500 € · сейчас 9 200 € (−3,2%)', 'start line, ru', sl('ru', s));
  s = st('2026-10-05', { t: at(4), p: 9500 }, 9200);
  check(/^В продаже с 05\.10\.2026 · первая цена, которую увидел CarScout \(12\.10\.2026\): 9 500 € · сейчас 9 200 € \(−3,2%\)$/.test(sl('ru', s)), 'start line when CarScout came late says so', sl('ru', s));
  s = st('2026-10-05', { t: at(4), p: 9500 }, 9500);
  check(/цена не менялась с 12\.10\.2026 \(наблюдение CarScout\)/.test(sl('ru', s)), 'an unchanged price is said to be unchanged only since CarScout watched', sl('ru', s));
  check(sl('ru', st('2026-10-05', null, 9200)) === 'В продаже с 05.10.2026', 'only the posting date known: only that is shown');
  check(sl('ru', st(null, null, 9200)) === '', 'nothing known: no line');
  for (const lang of ['en', 'lv']) {
    const t = sl(lang, st('2026-10-05', { t: at(10), p: 9500 }, 9200)) + ' | ' + J(mkctx(lang), `dropBadge({from: 9500, to: 9200, t: ${at(1)}, steps: 2})`);
    check(t.length > 60 && !/undefined|NaN|null/.test(t), lang + ': start line and arrow badge are complete', t);
  }
  const badge = J(ru, `dropBadge({from: 9500, to: 9200, t: ${at(1)}, steps: 2})`);
  check(/▼/.test(badge) && /−300 € \(−3%\) ×2/.test(badge) && /Цена снижена с 9 500 € до 9 200 €/.test(badge) && /class="dropb"/.test(badge), 'the arrow badge shows the amount, the percent and when it was noticed', badge);

  /* the trip */
  const e = (x) => J(ru, x);
  check(e('tripCons("petrol",1.6)') === 7.0 && e('tripCons("diesel",2.0)') === 6.0 && e('tripCons("hybrid",1.8)') === 5.5 && e('tripCons("petrol",null)') === 8.0 && e('tripCons("diesel",3.0)') === 7.5, 'consumption guide by fuel and engine size');
  check(e('tripCost(100, 2, 7, 2.038)') === 29 && e('tripCost(100, 1, 7, 2.038)') === 14, 'trip cost = km × legs × l/100 × price, one leg is half');
  check(e('tripPrice("diesel")') === 2.133 && e('tripPrice("petrol")') === 2.038 && e('tripPrice("hybrid")') === 2.038, 'diesel uses the diesel price, the rest the petrol price');
  check(e('tripSum(29, 300)').key === 'win' && e('tripSum(29, 300)').net === 271, 'cheaper than market and the trip is small: you keep the difference');
  check(e('tripSum(400, 300)').key === 'lose' && e('tripSum(400, 300)').net === -100, 'the trip eats the whole difference');
  check(e('tripSum(29, -200)').key === 'above' && e('tripSum(29, -200)').gain === 200, 'dearer than market is said as dearer');
  check(e('tripSum(29, 20)').key === 'flat' && e('tripSum(29, -20)').key === 'flat', 'within 50 euros of the market counts as the market price');
  check(e('tripSum(29, null)').key === 'cost', 'without a market comparison only the cost is said, no verdict');
  check(e('tripLine(100, 2, 7, 2.038, 300)') === 'Машина ниже рынка примерно на 300 €, поездка ≈ 29 €: останется выгода ≈ 271 €.', 'trip text: win', e('tripLine(100, 2, 7, 2.038, 300)'));
  check(/съедает эту разницу/.test(e('tripLine(300, 2, 9, 2.133, 100)')), 'trip text: the trip eats the difference');
  check(e('tripLine(100, 2, 7, 2.038, null)') === 'Поездка обойдётся примерно в 29 € на топливо.', 'trip text without a market comparison');
  for (const lang of ['en', 'lv']) {
    const t = ['300', '-300', '10', 'null'].map(g => J(mkctx(lang), `tripLine(100, 2, 7, 2.038, ${g})`)).join(' | ');
    check(t.length > 80 && !/undefined|NaN|null/.test(t), lang + ': trip lines are complete', t);
  }
  const off = vm.createContext({ S: { lang: 'ru' }, lvT: x => x, console }); vm.runInContext(code.replace('TRIP_BETA=true', 'TRIP_BETA=false') + '\n' + html.slice(html.indexOf('function tripBeta'), tz), off);
  check(vm.runInContext('tripBeta({ car: {} })', off) === '', 'with the test switch off the trip block is not drawn');

  /* the cost of 100 km of an electric car */
  check(e('evCons("Tesla","Model 3")') === 16 && e('evCons("Porsche","Taycan")') === 21 && e('evCons("Renault","Zoe")') === 16 && e('evCons("Kia","EV6")') === 18 && e('evCons(null,null)') === 18, 'EV consumption guide by class');
  check(e('evCost100(18, 0.22)') === 4 && e('evCost100(18, 0.4)') === 7.2 && e('evCost100(16, 0.2)') === 3.2, 'EV cost of 100 km = kWh/100 km × price, one decimal');
  check(e('evMoney(7.2)') === '7,2 €' && e('evMoney(null)') === '–', 'EV money is written with a comma and a euro sign');
  check(e('evLine(18, 0.22, 0.4, 7, 2.038)') === '100 км: ≈ 4,0 € на домашней зарядке, ≈ 7,2 € на быстрой. Бензиновая машина (7 л/100 км) — ≈ 14,3 €. Дома на 100 км дешевле бензина на ≈ 10,3 €.', 'EV line: home, fast and the petrol comparison', e('evLine(18, 0.22, 0.4, 7, 2.038)'));
  for (const lang of ['en', 'lv']) {
    const t = J(mkctx(lang), 'evLine(18, 0.22, 0.4, 7, 2.038)');
    check(t.length > 80 && !/undefined|NaN|null/.test(t) && /4,0 €/.test(t) && /14,3 €/.test(t), lang + ': EV line is complete', t);
  }
  {
    const evCode = code + '\n' + line(/^function isEvCar\(c\)\{[\s\S]*?\n\}/m) + '\n' + html.slice(html.indexOf('function evBlock'), html.indexOf('function evRecalc'));
    const mk = (lang, extra = '') => { const c = vm.createContext({ S: { lang }, lvT: x => x, console }); vm.runInContext(evCode + '\n' + extra, c); return c; };
    const tesla = { sell: false, car: { make: 'Tesla', model: 'Model 3', fuel: 'electric' } };
    const blk = J(mk('ru'), `evBlock(${JSON.stringify(tesla)})`);
    check(/id="ev-cost"/.test(blk) && /id="ev-cons" inputmode="decimal" value="16"/.test(blk) && /≈ 3,5 € на домашней/.test(blk), 'EV ad: the 100 km block is drawn with the editable fields', blk && blk.slice(0, 80));
    check(J(mk('ru'), `evBlock(${JSON.stringify({ sell: false, car: { make: 'Skoda', model: 'Octavia', fuel: 'petrol' } })})`) === '', 'a petrol car gets no EV block');
    check(J(mk('ru'), `evBlock(${JSON.stringify({ sell: true, car: { make: 'Tesla', model: 'Model 3', fuel: 'electric' } })})`) === '', 'selling your own car: no EV block');
    check(J(mk('ru', 'EV_COST=false;'), `evBlock(${JSON.stringify(tesla)})`) === '', 'with the test switch off the EV block is not drawn');
    const lv = J(mk('lv'), `evBlock(${JSON.stringify(tesla)})`);
    check(/Cik maksā 100 km/.test(lv) && !/undefined|NaN/.test(lv), 'EV block in Latvian is complete');
  }
}

/* ---------- 9. the verdict picture: what it says (the drawing itself is checked by looking at it in a browser) ---------- */
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const line = re => { const m = html.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
  const sl = (a, z) => html.slice(html.indexOf(a), html.indexOf(z));
  const code = [line(/^function esc\(s\)\{.*$/m), line(/^function L\(ru,en,lv\)\{.*$/m), line(/^function LP\(a\)\{.*$/m), line(/^function fmt\(n\)\{.*$/m), line(/^function eur\(n\)\{.*$/m), line(/^function pct\(d\)\{.*$/m), line(/^function memDate\(t\)\{.*$/m), line(/^var VNAME=.*$/m),
    sl('/*BETA-PURE-START*/', '/*BETA-PURE-END*/'), sl('function dropBadge', 'function dropPlace'), sl('/*CARD-PURE-START*/', '/*CARD-PURE-END*/')].join('\n');
  const stubs = `function trimDisplay(k){return k} function fuelLabel(c){return c.fuel==='diesel'?'дизель':''} function aGear(g){return g==='automatic'?'Автомат':'Механика'}
    function rname(cc){return cc} function rloc(cc){return cc} function planOf(v){return v.car.price&&v.fair?{offer:8800,max:9300}:null}
    function flagsOf(){return {risks:['r1','r2','r3','r4'],pros:['p1','p2','p3','p4']}}`;
  const mk = (lang) => { const c = vm.createContext({ S: { lang }, lvT: x => x, console }); vm.runInContext(code + '\n' + stubs, c); return c; };
  const J = (c, expr) => JSON.parse((vm.runInContext('JSON.stringify(' + expr + ')', c) || 'null').replace(/[  ]/g, ' '));
  const ru = mk('ru');
  check(/function cardLines/.test(code) && /function cardWrap/.test(code), 'the picture functions are found in index.html');

  const meas = 'function(t){return t.length*10}';
  check(JSON.stringify(vm.runInContext(`cardWrap(${meas}, 'aaa bbb ccc ddd', 70)`, ru)) === '["aaa bbb","ccc ddd"]', 'text wraps at the width');
  const wrapped = vm.runInContext(`cardWrap(${meas}, 'сейчас 9\\u00a0200 € (−3,2%) ещё', 80)`, ru);
  check(wrapped.every(l => !/9$/.test(l) && !/^200/.test(l)), 'a number with a non-breaking space is never split across lines', wrapped);
  check(JSON.stringify(vm.runInContext(`cardClamp(['a','b','c','d','e'], 3)`, ru)) === '["a","b","c…"]' && JSON.stringify(vm.runInContext(`cardClamp(['a','b'], 3)`, ru)) === '["a","b"]', 'too many lines are cut with …, short text is left alone');

  const now = Date.now(), day = 86400000;
  /* the ad was posted on the day CarScout first saw it (both relative to today, so the check does not age) */
  const posted = new Date(now - 10 * day).toISOString().slice(0, 10);
  const view = (x = {}) => Object.assign({ car: { make: 'Volkswagen', model: 'Golf', year: 2017, km: 148000, fuel: 'diesel', gear: 'manual', price: 9200, posted, trims: [], phone: '+371 20000000', sellerName: 'Jānis' },
    ver: { key: 'good', delta: -9.1 }, fair: { mid: 10120, low: 9500, high: 10800, source: 'comps-reg' }, home: { n: 23, region: 'LV', tol: 1 },
    drop: { from: 9500, to: 9200, t: now - day, steps: 1 }, mem: { raw: { self: { first: { t: now - 10 * day, p: 9500 } } } }, cross: null }, x);
  const cl = (lang, v) => J(mk(lang), `cardLines(${JSON.stringify(v)})`);
  let d = cl('ru', view());
  check(d.title === 'Volkswagen Golf 2017' && d.price === '9 200 €' && d.priceNote === 'цена в объявлении' && d.verdict === 'Ниже рынка · −9,1% к рынку', 'title, price and verdict are written', d);
  check(/^Сравнение: 23 похожих объявл\. в LV \(год ±1\)\. Обычная цена 10 100 € \(от 9 500 € до 10 800 €\)\.$/.test(d.basis), 'the verdict says what it was compared with: number of ads, market, typical price and range', d.basis);
  check(d.plan === 'Торг: предложить 8 800 €, максимум 9 300 €', 'the negotiation line is there', d.plan);
  check(/^Цена снижена на 300 € \(−3,2%\)/.test(d.drop) && /цена в начале продажи 9 500 €/.test(d.start), 'the recent price drop and the start of sale are written', d);
  check(d.risks.length === 3 && d.pros.length === 3, 'at most three risks and three pros', d);
  check(!/Jānis|\+371/.test(JSON.stringify(d)), 'no seller name or phone ends up in the picture');
  d = cl('ru', view({ drop: null }));
  check(d.drop === '', 'no recent drop: no arrow line');
  d = cl('ru', view({ home: null }));
  check(/без сопоставимых объявлений/.test(d.basis), 'a verdict from an estimate says that no comparable ads were used', d.basis);
  d = cl('ru', view({ fair: null, home: null, ver: { key: 'unknown', delta: null } }));
  check(d.basis === '' && d.plan === '' && d.verdict === 'Нет данных', 'without a fair price there is no basis line, no plan and the verdict says no data', d);
  d = cl('ru', view({ cross: { region: 'LV', n: 31, mid: 11410, diff: 2200 } }));
  check(/^В LV похожие стоят около 11 400 € \(31 объявл\.\)\.$/.test(d.cross), 'a car on sale abroad shows what similar cars cost in Latvia', d.cross);
  d = cl('ru', view({ car: { make: '', model: '', year: null, km: null, price: 0, trims: [] } }));
  check(d.title === 'Автомобиль' && d.price === 'цена не указана' && d.priceNote === '', 'a car with no data still gets a title and "no price"', d);
  for (const lang of ['en', 'lv']) {
    const t = JSON.stringify(cl(lang, view({ cross: { region: 'DE', n: 12, mid: 12000, diff: 1000 } })));
    check(t.length > 400 && !/undefined|NaN|null/.test(t), lang + ': the picture text is complete', t);
  }
}

/* auto24 (.ee / .lv / .lt): a real ad page (auto24.lv/lietoti/4361580, cut down). The generic reader took the year 2022 from the page
   instead of 08/2012, missed the 3.0 engine and four-wheel drive, and did not see that the car stands in Estonia, so a normal
   price looked far below the market. The main table is read by its row classes, the same in every language. */
{
  const row = (cls, label, value, extra = '') => `<tr class="field-${cls}"> <td class="label"><span>${label}</span></td> <td class="field"><span class="value">${value}</span>${extra}</td> </tr>`;
  const page = (L, loc, status) => `<!DOCTYPE html><html><head><title>Audi A6 3.0 180kW - auto24.lv</title>
<meta property="og:title" content="Audi A6 3.0 180kW"><meta property="og:description" content="2012, dīzelis, 371 898 km, 9300&nbsp;EUR - lietoti transportlīdzekļi, Igaunija">
<meta property="og:image" content="https://img13.img-bcg.eu/h30/fc2f18/s7/206934985.jpg"></head><body>
<div class="b-breadcrumbs"><a href="/kasutatud/nimekiri.php?a=101102" class="b-breadcrumbs__item">Passenger_and_suv</a><span>&raquo;</span><a href="/kasutatud/nimekiri.php?a=101102&b=2" class="b-breadcrumbs__item">Audi</a><span>&raquo;</span><a href="/kasutatud/nimekiri.php?a=101102&b=2&bw=89" class="b-breadcrumbs__item">A6</a><span>&raquo;</span><a href="/kasutatud/nimekiri.php?a=101102&b=2&bw=89&f1=2011&f2=2013" class="b-breadcrumbs__item">2011-2013</a></div>
<p>Jaunākie: Audi Q5 2022, 45 900 EUR</p>
<h1 class="commonSubtitle">Audi A6 3.0 180kW <div class='bs-modules bookmark'></div></h1>
<table class="main-data">${row('liik', L[0], L[1])}${row('keretyyp', L[2], L[3])}${row('month_and_year', L[4], '08/2012')}${row('mootorvoimsus', L[5], '3.0 180kW')}${row('kytus', L[6], L[7])}
${row('labisoit', L[8], '371 898 km', ' <span>&middot;</span> servisa grāmata')}${row('vedavsild', L[9], L[10])}${row('kaigukast_kaikudega', L[11], L[12])}${row('hind', 'Cena', '9300&nbsp;EUR', '<br><span class="vat-value">PVN 0%</span>')}</table>
<a class="vImages__item -hide" href="https://img13.img-bcg.eu/h30/b81281/s7/206934990.jpg"><img src="x.jpg"></a>
<h2 class="commonSubtitle">Aprīkojums</h2><div class="section vEquipment -has-more"><ul class="group full"><li class="item">8x gaisa spilveni</li><li class="item">S line sporta pakete</li></ul>
<table class="group full"><tr class="item"><td class="label">motora apjoms:</td><td class="value">2967 <span class="-unit">cm&sup3;</span></td></tr><tr class="item"><td class="label">vidējais:</td><td class="value">6 <span class="-unit">l/100 km</span></td></tr></table></div>
<h2 class="commonSubtitle">Cita informācija</h2><div class="section other-info"><div class="-status">${status}</div><div class="-location">${loc}</div><div class="-user_other"><br/>Sõiduk on eksporditud Rootsist 2018 aastal.</div></div></body></html>`;
  const LV = ['Tips', 'vieglais automobilis', 'Virsbūves tips', 'sedans', 'Pirmā reğ', 'Motors', 'Degviela', 'dīzelis', 'Spidometra rādījums', 'Piedziņa', 'pilnpiedziņa', 'Ātrumkārba', 'automātiskā'];
  const EE = ['Liik', 'sõiduauto', 'Keretüüp', 'sedaan', 'Esmane reg', 'Mootor', 'Kütus', 'diisel', 'Läbisõidumõõdiku näit', 'Vedav sild', 'nelikvedu', 'Käigukast', 'automaat'];
  const RU = ['Тип', 'легковой', 'Тип кузова', 'седан', 'Первая рег', 'Двигатель', 'Топливо', 'дизель', 'Показание одометра', 'Ведущий мост', 'полный привод', 'Коробка передач', 'автомат'];
  ctx.__a24 = [page(LV, 'Transportlīdzekļa atrašanās vieta: Igaunija', 'Reģistrēts Igaunijā'), page(EE, 'Sõiduki asukoht: Eesti', 'Eestis arvel'), page(RU, 'Местонахождение автомобиля: Латвия', 'На учете в Латвии')];
  const r = JSON.parse(W(`JSON.stringify(__a24.map(function (h) { const x = parseA24Listing(h, 'https://www.auto24.lv/lietoti/4361580'); return { L: x.listing, images: x.images, title: x.title }; }))`));
  for (const [i, lang] of [[0, 'LV page'], [1, 'EE page'], [2, 'RU page']]) {
    const L = r[i].L;
    check(L.make === 'Audi' && L.model === 'A6', `auto24 ${lang}: make and model from the breadcrumbs`, [L.make, L.model]);
    check(L.year === 2012, `auto24 ${lang}: the year is the first registration 08/2012 (not 2022 from another ad on the page)`, L.year);
    check(L.engine_l === 3 && L.power_kw === 180, `auto24 ${lang}: engine 3.0 l, 180 kW`, [L.engine_l, L.power_kw]);
    check(L.fuel === 'diesel' && L.gearbox === 'automatic' && L.drive === 'awd', `auto24 ${lang}: diesel, automatic, four-wheel drive`, [L.fuel, L.gearbox, L.drive]);
    check(L.mileage_km === 371898 && L.asking_price === 9300, `auto24 ${lang}: mileage and price`, [L.mileage_km, L.asking_price]);
  }
  check(r[0].L.country === 'EE' && r[1].L.country === 'EE' && r[2].L.country === 'LV', 'auto24: the country is where the car stands (an auto24.lv ad of a car in Estonia gives EE)', r.map(x => x.L.country));
  check(/S line/.test(r[0].L.description), 'auto24: the equipment list goes into the description, so the trim can be found', r[0].L.description.slice(0, 120));
  check(r[0].images.length === 2 && r[0].images.every(u => /img-bcg\.eu/.test(u)) && W(`imgAllowed('https://img13.img-bcg.eu/h30/b81281/s7/206934990.jpg')`), 'auto24: the photos are found and allowed', r[0].images);
  check(r[0].title === 'Audi A6 3.0 180kW', 'auto24: the title', r[0].title);
  check(W(`parseA24Listing('<html><body>no table</body></html>', 'https://www.auto24.ee/used/1') === null`), 'auto24: a page without the main table falls back to the generic reader');
}

/* auto24 and autogidas.lt as sources of similar cars (markup copied from the live sites, October 2026) */
{
  const a24row = (id, eng, yr, km, fuel, gear, drive, price) => `<div class="result-row item-odd v-log " data-hsh="x"> <div class="thumbnail"><a href="/soidukid/${id}" class="small-image" ><img class="thumb" src="https://img13.img-bcg.eu/h32/de2e95/s1/v2/${id}.jpg" loading="lazy"></a></div> <div class="description"> <div class="title"> <a href="/soidukid/${id}" class="main"><span>Audi</span> <span class="model">A6</span> <span class="engine">${eng}</span></a><span class="tbl-columns"><span class="year">${yr}</span><span class="finance"><span class="pv"><span class="price">${price}&nbsp;&euro;</span></span><a href="/soidukid/${id}#loan=72" class="loan-adv small"><span>kuumakse al. <span style="font-weight: bold;">109&nbsp;&euro;</span></span></a></span></span> </div> <div class="extra"> <span class="year">${yr}</span><span class="mileage">${km}&nbsp;km</span><span class="fuel sm-none">${fuel}</span><span class="transmission sm-none">${gear}</span><span class="bodytype">Universaal</span><span class="drive">${drive}</span> </div> </div> <a href="/soidukid/${id}" class="row-link" target="_self"></a> </div>`;
  const opt = (v, t, lvl) => `<option class="input-option${lvl ? ' level-1' : ''}" value="${v}">${t}</option>`;
  const form = (makeSel, models) => `<select class="input-select" id="searchParam-cmm-1-make" data-ilabel="Mark" name="b"><option class="input-option" value="">kõik</option>${opt(9, 'Alfa Romeo')}<option class="input-option" value="2"${makeSel ? ' selected="selected"' : ''}>Audi</option>${opt(4, 'BMW')}${opt(12, 'Mercedes-Benz')}${opt(40, 'Skoda')}</select>` +
    (models ? `<label class="label" for="searchParam-cmm-1-model_id">Mudel</label><div class="field"><select class="input-select" id="searchParam-cmm-1-model_id" multiple="multiple" size="1" data-ilabel="Mudel" name="bw[]"><option class="input-option" value="">kõik</option>${models}</select></div>` : '');
  const audiModels = opt(85, 'A4 (kõik)') + opt(86, 'A4', 1) + opt(1511, 'A6 (kõik)') + opt(89, 'A6', 1) + opt(90, 'A6 allroad', 1) + opt(812, 'S6');
  const bmwModels = opt(881, '1 seeria (kõik)') + opt(1181, '116', 1) + opt(883, '5 seeria (kõik)') + opt(1185, '520', 1) + opt(21, 'X5');
  const mbModels = opt(152, 'E-klass (kõik)') + opt(1265, 'E 220', 1) + opt(1273, 'E 300', 1);
  const list = a24row(4357217, '2.0 130kW', 2012, '337 000', 'Diisel', 'Automaat', 'Esivedu', 6900) + a24row(4355546, '3.0 180kW', 2012, '290 500', 'Diisel', 'Automaat', 'Nelikvedu', 9800) + a24row(4361580, '3.0 180kW', 2012, '371 898', 'Diisel', 'Automaat', 'Nelikvedu', 9300);
  ctx.__f = { list, audi: form(true, audiModels), bmw: form(false, bmwModels), mb: form(false, mbModels) };
  const it = JSON.parse(W(`JSON.stringify(parseA24List(__f.list))`));
  check(it.length === 3 && it[0].price === 6900 && it[0].year === 2012 && it[0].km === 337000 && it[0].url === 'https://www.auto24.ee/soidukid/4357217', 'auto24 list: price, year, mileage and link of each row', it[0]);
  check(it[1].engine_l === 3 && it[1].fuel === 'diesel' && it[1].gear === 'automatic' && it[1].drive === 'awd' && it[0].drive === 'fwd', 'auto24 list: engine, fuel, gearbox and drive', it[1]);
  const pk = JSON.parse(W(`JSON.stringify([a24Pick(a24Options(__f.audi, 'b'), 'Audi', true), a24Pick(a24Options(__f.audi, 'bw[]'), 'A6'), a24Pick(a24Options(__f.audi, 'b'), 'Mercedes', true), a24Pick(a24Options(__f.audi, 'b'), 'Škoda', true),
    a24Pick(a24Options(__f.bmw, 'bw[]'), '5 Series'), a24Pick(a24Options(__f.bmw, 'bw[]'), 'X5'), a24Pick(a24Options(__f.mb, 'bw[]'), 'E-Class'), a24Pick(a24Options(__f.mb, 'bw[]'), 'E 300'), a24Pick(a24Options(__f.audi, 'bw[]'), 'Q7')])`));
  check(JSON.stringify(pk) === JSON.stringify(['2', '1511', '12', '40', '883', '21', '152', '1273', null]), 'auto24 make and model numbers: A6 = the whole A6 line, Mercedes = Mercedes-Benz, Škoda = Skoda, 5 Series = "5 seeria", E-Class = "E-klass", unknown model = none', pk);
  /* the whole search through the worker: make number -> model number -> results of cars standing in Estonia */
  const B = 'https://www.auto24.ee/kasutatud/nimekiri.php?a=101102';
  pages[B] = { status: 200, body: ctx.__f.audi.replace(' selected="selected"', '') };
  pages[B + '&b=2'] = { status: 200, body: ctx.__f.audi };
  pages[B + '&b=2&bw=1511&f1=2011&f2=2013&ab%5B%5D=-1'] = { status: 200, body: '<div id="usedVehiclesSearchResult-flex">' + list + '</div>' };
  pages[B + '&b=2&bw=1511&f1=2011&f2=2013&ab%5B%5D=-1&ak=50'] = { status: 200, body: '<div></div>' };
  const res = JSON.parse(await W(`hComps(env, new URLSearchParams('source=auto24&cc=EE&make=Audi&model=A6&year=2012'), null).then(function (r) { return r.text(); })`));
  check(res.ok && res.region === 'EE' && res.items.length === 3 && res.modelId === '1511' && /ab%5B%5D=-1/.test(res.searchUrl), 'auto24 source: Audi A6 2011–2013 standing in Estonia, 3 ads, the search link is given', { ok: res.ok, n: (res.items || []).length, err: res.error, url: res.searchUrl });
  const resLv = JSON.parse(await W(`hComps(env, new URLSearchParams('source=auto24&cc=LV&make=Audi&model=A6&year=2012'), null).then(function (r) { return r.text(); })`));
  check(/www\.auto24\.lv/.test(resLv.searchUrl || '') && /ab%5B%5D=-2/.test(resLv.searchUrl || ''), 'auto24 source for Latvia asks for cars standing in Latvia and links to auto24.lv', resLv.searchUrl);

  const agCard = (id, price, yr, fuel, km, gear, eng, title = 'Audi A6') => `<article id="cars-container" class="list-item-new is-highlighted" data-price="${price}.00" data-updated="1791451837"> <div class="article-item"> <a class="item-link " role="link" tabindex="0" href="/skelbimas/audi-a6-${yr}-m-universalas-${id}.html" title="${title}"> <div class="right"> <div class="image"> <img width="268" height="200" src="https://img.autogidas.lt/4_16_${id}/image.jpg" class="js-image" alt="${title}" /> </div> </div> <div class="description"> <div class="display-flex space-between card-title-wrapper"> <div class="title-wrapper"> <h2 class="item-title"> ${title} </h2> </div> <div class="item-price-content"> <div class="item-price"> ${price} € </div> </div> </div> <div class="parameters"> <span class="parameter-value"> ${yr} m. </span> <span class="parameter-value"> ${fuel} </span> <span class="parameter-value"> ${km} km </span> <span class="parameter-value"> ${gear} </span> <span class="parameter-value"> ${eng} </span> <span class="parameter-value"> Vilnius </span> </div> </div> </a> </div> </article>`;
  ctx.__ag = agCard('0140033298', 7900, 2012, 'Dyzelinas', '245 995', 'Automatinė', '2.0 L / 130 kW') + agCard('0140033111', 11000, 2013, 'Benzinas', '180 000', 'Mechaninė', '3.0 L / 220 kW') + agCard('0140033222', 50, 2012, 'Dyzelinas', '1 000', 'Automatinė', '2.0 L / 130 kW');
  const ag = JSON.parse(W(`JSON.stringify(parseAgList(__ag))`));
  check(ag.length === 2 && ag[0].price === 7900 && ag[0].year === 2012 && ag[0].km === 245995 && ag[0].url === 'https://autogidas.lt/skelbimai/audi-a6-2012-m-universalas-0140033298.html'.replace('skelbimai', 'skelbimas'), 'autogidas list: price, year, mileage and link (a 50 € card is dropped)', ag[0]);
  check(ag[0].fuel === 'diesel' && ag[0].gear === 'automatic' && ag[0].engine_l === 2 && ag[0].power_kw === 130 && ag[1].fuel === 'petrol' && ag[1].gear === 'manual' && ag[1].engine_l === 3, 'autogidas list: fuel, gearbox, engine and power', ag);
}

console.log(oks.map(x => '✔ ' + x).join('\n'));
if (fails.length) { console.log('\n' + fails.map(x => '✘ ' + x).join('\n')); process.exit(1); }
console.log(`\n${oks.length} checks passed`);
