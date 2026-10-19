// CarScout check of the daily database clean-up (worker/worker.js, dbCleanup) on a real SQLite database.
// It checks which rows go and which stay (ss.com and VIN ads live longer than the others), that the price history goes
// with its ad and never without it, the daily gate, the cap per run (so a free D1 database is not flooded with deletes),
// that the cron really runs it, and that it does not read the whole table. No network. Run: node tools/dbcheck.mjs   (Node 22+)
import { loadWorker, makeD1, checker, DAY } from './lib/offline.mjs';

const { check, finish } = checker('database clean-up');
const { T, ctx, W } = loadWorker();
const T0 = T.now;
const DB = makeD1(); ctx.env = { DB, ALLOW_ORIGIN: '*' };
const q = (sql, ...a) => DB.raw.prepare(sql).all(...a);
const n = (sql, ...a) => q(sql, ...a)[0].n;
await W('memInit(env)'); await W('pushInit(env)');

const insAd = DB.raw.prepare('INSERT INTO ads(id, src, mk, md, yr, vin, title, ft, fp, fkm, lt, lp, lkm, n, gone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insHist = DB.raw.prepare('INSERT INTO hist(id, t, p, km) VALUES(?,?,?,?)');
/* age = days since the ad was last seen; goneAge = days since it went off sale (null = never marked gone) */
const ad = (id, src, age, goneAge = null, vin = null) => {
  const lt = T0 - age * DAY;
  insAd.run(id, src, 'volkswagen', 'golf', 2015, vin, 'Golf', lt - 10 * DAY, 9000, 150000, lt, 8800, 150000, 3, goneAge == null ? null : T0 - goneAge * DAY);
  insHist.run(id, lt - 10 * DAY, 9000, 150000); insHist.run(id, lt, 8800, 150000);
};
const left = () => q('SELECT id FROM ads ORDER BY id').map(r => r.id);

/* ---------- 1. which rows go ---------- */
ad('ss:gone400', 'ss', 410, 400);               // ss.com, off sale 400 days ago      -> goes
ad('ss:gone200', 'ss', 210, 200);               // ss.com, off sale 200 days ago      -> stays (ss.com is kept a year)
ad('as:gone150', 'as24', 160, 150);             // other site, off sale 150 days ago  -> goes (they are kept 120 days)
ad('as:gone100', 'as24', 110, 100);             // other site, off sale 100 days ago  -> stays
ad('as:vin150', 'as24', 160, 150, 'WVWZZZ1KZAW000001');   // other site but with a VIN -> stays (kept like ss.com)
ad('as:vin400', 'as24', 410, 400, 'WVWZZZ1KZAW000002');   // ... until a year has passed -> goes
ad('ss:lost400', 'ss', 400);                     // never marked gone, not seen for 400 days -> goes
ad('ss:lost200', 'ss', 200);                     // ... 200 days -> stays
ad('as:lost130', 'as24', 130);                   // other site, not seen for 130 days -> goes
ad('as:lost50', 'as24', 50);                     // other site, 50 days -> stays
ad('ss:live', 'ss', 0);                          // seen today -> stays
const pinIns = DB.raw.prepare('INSERT INTO pinbox(code, t, data) VALUES(?,?,?)');
pinIns.run('abc', T0 - 20 * DAY, '{}'); pinIns.run('abc', T0 - 1 * DAY, '{}');
DB.raw.exec("INSERT INTO trk(src, cat, t) VALUES('ss', 'volkswagen/golf', 1)");
const histBefore = n('SELECT COUNT(*) AS n FROM hist');

const r1 = await W('dbCleanup(env, true)');
const gone = ['ss:gone400', 'as:gone150', 'as:vin400', 'ss:lost400', 'as:lost130'];
const kept = ['as:gone100', 'as:lost50', 'as:vin150', 'ss:gone200', 'ss:live', 'ss:lost200'];
check(JSON.stringify(left()) === JSON.stringify(kept.slice().sort()), 'the right ads are removed: ss.com a year after, the others after 120 days, VIN ads a year after', { left: left(), want: kept.slice().sort() });
check(r1.ok && r1.ads === gone.length && r1.hist === gone.length * 2 && r1.inbox === 1, 'the answer counts what was removed (5 ads, their 10 history rows, 1 old phone message)', r1);
check(q('SELECT DISTINCT id FROM hist ORDER BY id').map(r => r.id).join() === kept.slice().sort().join(), 'the price history of the removed ads is gone, the history of the others is untouched', q('SELECT DISTINCT id FROM hist').map(r => r.id));
check(n('SELECT COUNT(*) AS n FROM hist') === histBefore - gone.length * 2, 'no history row of a remaining ad was lost', n('SELECT COUNT(*) AS n FROM hist'));
check(n('SELECT COUNT(*) AS n FROM pinbox') === 1 && q('SELECT t FROM pinbox')[0].t === T0 - 1 * DAY, 'an uncollected phone message older than 14 days is removed, a fresh one stays');
check(n('SELECT COUNT(*) AS n FROM trk') === 1, 'the table of watched categories is not touched');

/* ---------- 2. once a day ---------- */
let r = await W('dbCleanup(env, false)');
check(r.skipped === true, 'a second call at once does nothing (one run a day)', r);
T.now += 22 * 3600000; r = await W('dbCleanup(env, false)');
check(r.skipped === true, 'still nothing 22 hours later', r);
T.now += 2 * 3600000; r = await W('dbCleanup(env, false)');
check(r.ok && !r.skipped && r.ads === 0, 'it runs again after 24 hours and finds nothing new to remove', r);
/* time passes: ads that were kept become old enough */
T.now += 30 * DAY;
r = await W('dbCleanup(env, false)');
check(r.ads === 1 && !left().includes('as:gone100') && left().includes('as:lost50') && left().includes('as:vin150'), 'a month later only the ad that crossed its limit goes (other site, off sale 100 -> 131 days); 80 days and a VIN ad stay', { r, left: left() });

/* ---------- 3. a cap per run: an old backlog is cleared over several days ---------- */
const CAP = W('GC_BATCH');
check(CAP >= 500 && CAP <= 5000, 'the cap per run stays small enough for the free database (100 000 rows written a day, an ad is about 5 with its indexes and history)', CAP);
DB.raw.exec('BEGIN'); for (let k = 0; k < CAP + 500; k++) { insAd.run('ss:old' + k, 'ss', 'volkswagen', 'golf', 2015, null, 'Golf', 1, 9000, 150000, 2, 9000, 150000, 1, T.now - 500 * DAY); insHist.run('ss:old' + k, 2, 9000, 150000); } DB.raw.exec('COMMIT');
r = await W('dbCleanup(env, true)');
check(r.ads === CAP && r.hist === CAP && n("SELECT COUNT(*) AS n FROM ads WHERE id LIKE 'ss:old%'") === 500, `one run removes at most ${CAP} ads, the rest wait for the next run`, { r, left: n("SELECT COUNT(*) AS n FROM ads WHERE id LIKE 'ss:old%'") });
r = await W('dbCleanup(env, true)');
check(r.ads === 500 && n("SELECT COUNT(*) AS n FROM ads WHERE id LIKE 'ss:old%'") === 0 && n("SELECT COUNT(*) AS n FROM hist WHERE id LIKE 'ss:old%'") === 0, 'the next run clears the rest, with their history', r);

/* ---------- 4. it does not read the whole table ---------- */
const plan = (sql) => q('EXPLAIN QUERY PLAN ' + sql.replace(/\?\d/g, '1')).map(x => x.detail).join(' | ');
/* the two SELECTs are inside dbCleanup: take their text from the source so the test follows the code */
const src = (await import('node:fs')).readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
const picks = [...src.matchAll(/const (pickGone|pickLost) = "([^"]+)"/g)].map(m => [m[1], m[2]]);
check(picks.length === 2, 'both selection queries are found in the worker', picks.map(p => p[0]));
for (const [name, sql] of picks) { const p = plan(sql); check(/SEARCH ads USING (COVERING )?INDEX ads_alive/.test(p) && !/SCAN ads/.test(p), `${name} looks rows up in the ads_alive index by range (does not scan the whole table)`, p); }

/* ---------- 5. the cron runs it ---------- */
ad('ss:cron-old', 'ss', 420, 410);
const waits = []; T.now += 2 * DAY;
await ctx.__worker.scheduled({}, ctx.env, { waitUntil: (p) => waits.push(p) });
await Promise.all(waits);
check(!left().includes('ss:cron-old'), 'the scheduled (cron) handler runs the clean-up', left());
check(n("SELECT COUNT(*) AS n FROM hist WHERE id = 'ss:cron-old'") === 0, 'and removes its history');

/* ---------- 6. no database, and a missing phone table ---------- */
check((await W('dbCleanup({}, true)')).error === 'no_db', 'without a database it answers "no_db" and does nothing');
DB.raw.exec('DROP TABLE pinbox'); T.now += DAY;
r = await W('dbCleanup(env, true)');
check(r.ok && r.inbox === 0, 'if the phone-message table does not exist yet, the rest still works', r);

finish();
