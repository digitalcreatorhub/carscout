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
  check(l.some(x => /висит 60 дней, а типичный срок — 17 дней: оно засиделось/.test(x)), 'an ad on sale twice as long as typical is called stale (a bargaining argument)', l);
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
}

console.log(oks.map(x => '✔ ' + x).join('\n'));
if (fails.length) { console.log('\n' + fails.map(x => '✘ ' + x).join('\n')); process.exit(1); }
console.log(`\n${oks.length} checks passed`);
