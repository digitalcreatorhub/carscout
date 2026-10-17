// CarScout daily self-check: reads real fresh ads through the live worker and checks that every field is read.
// Runs in GitHub Actions (free). On failure it opens or updates an issue, so GitHub e-mails the repo owner.
const W = process.env.WORKER || 'https://carscout.pmax70095.workers.dev';
const H = { origin: 'https://digitalcreatorhub.github.io' };
const fails = [], oks = [], warns = [];
const get = async (path, params, ms = 60000) => {
  const u = W + path + '?' + new URLSearchParams(params);
  for (let k = 0; k < 2; k++) {
    try { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(ms) }); return await r.json(); }
    catch (e) { if (k) return { ok: false, error: 'fetch: ' + e.message }; await new Promise(r => setTimeout(r, 3000)); }
  }
};
const bad = (what, detail) => fails.push(`- **${what}**: ${detail}`);
const good = (what) => oks.push(`- ${what}`);
const fuelOf = f => f === 'lpg' ? 'petrol' : f;

// 1. ss.lv / ss.com: fresh ads from several makes, each read in LV, RU and EN; the list row is the reference
const CATS = ['volkswagen', 'toyota', 'bmw', 'audi', 'skoda', 'mercedes', 'volvo', 'others'];
let adsChecked = 0;
for (const cat of CATS) {
  const list = await get('/api/search', { url: `https://www.ss.com/ru/transport/cars/${cat}/` });
  if (!list.ok || !(list.items || []).length) { bad(`ss.com list ${cat}`, list.error || 'no items'); continue; }
  const pick = list.items.filter(i => i.url && /\/msg\//.test(i.url)).slice(0, cat === 'others' ? 1 : 2);
  for (const it of pick) {
    const id = it.url.replace(/^.*\/msg\/[a-z]{2}\//, '');
    const vars = { lv: 'https://www.ss.lv/msg/lv/' + id, ru: 'https://www.ss.com/msg/ru/' + id, en: 'https://www.ss.com/msg/en/' + id };
    const got = {};
    for (const [lang, url] of Object.entries(vars)) {
      const j = await get('/api/listing', { url });
      if (!j.listing) { bad(`ss ${lang} ${url}`, j.error || 'no listing'); continue; }
      const l = j.listing; got[lang] = l;
      const miss = ['make', 'model', 'year', 'asking_price', 'fuel', 'gearbox', 'posted'].filter(k => l[k] == null || l[k] === '');
      if (cat !== 'others' && l.mileage_km == null && it.km != null) miss.push('mileage_km');
      if (miss.length) bad(`ss ${lang} ${url}`, 'not read: ' + miss.join(', '));
      if (it.year && l.year && it.year !== l.year) bad(`ss ${lang} ${url}`, `year ${l.year}, list says ${it.year}`);
      if (it.price && l.asking_price && Math.abs(it.price - l.asking_price) > 1) bad(`ss ${lang} ${url}`, `price ${l.asking_price}, list says ${it.price}`);
      if (it.km && l.mileage_km && Math.abs(it.km - l.mileage_km) > 1000) bad(`ss ${lang} ${url}`, `mileage ${l.mileage_km}, list says ${it.km}`);
      if (it.fuel && l.fuel && fuelOf(it.fuel) !== fuelOf(l.fuel) && !(it.fuel === 'petrol' && l.fuel === 'hybrid')) bad(`ss ${lang} ${url}`, `fuel ${l.fuel}, engine column says ${it.fuel}`);
      adsChecked++;
    }
    const langs = Object.keys(got);
    for (const k of ['make', 'model', 'year', 'mileage_km', 'asking_price', 'fuel', 'gearbox', 'lpg']) {
      const vals = [...new Set(langs.map(l => JSON.stringify(got[l][k])))];
      if (vals.length > 1) bad(`ss languages differ ${id}`, `${k}: ` + langs.map(l => l + '=' + JSON.stringify(got[l][k])).join(' '));
    }
  }
}
good(`ss: ${adsChecked} ad pages read (LV/RU/EN)`);

// 2. seller data (views + other ads by phone)
{
  const list = await get('/api/search', { url: 'https://www.ss.com/ru/transport/cars/volkswagen/' });
  const it = (list.items || [])[0];
  if (it) { const s = await get('/api/seller', { url: it.url }); if (!s.ok || s.views == null) bad('ss seller', s.error || 'no views'); else good(`ss seller: views ${s.views}, ${s.phoneLinked ? 'cars ' + s.carAds : 'no phone link (other ads hidden by seller)'}`); }
}

// 3. comparables on every market
const MODELS = [['Volkswagen', 'Golf', 2018, 'petrol'], ['Toyota', 'RAV4', 2019, ''], ['Volkswagen', 'Arteon', 2020, 'diesel']];
const SRC = [['ss', {}], ['autoplius', {}], ['autogidas', {}], ['autoportaal', {}], ['auto24', { cc: 'EE' }], ['auto24', { cc: 'LV' }], ['as24', { cy: 'D' }], ['as24', { cy: 'B' }], ['as24', { cy: 'NL' }], ['as24', { cy: 'F' }]];
for (const [make, model, year, fuel] of MODELS) for (const [source, extra] of SRC) {
  if (source === 'autoplius' && model !== 'Golf') continue; // autoplius limits bursts of requests
  const name = `${source}${extra.cy ? ' ' + extra.cy : ''}${extra.cc ? ' ' + extra.cc : ''} ${make} ${model}`;
  const j = await get('/api/comps', Object.assign({ source, make, model, year, fuel }, extra));
  const its = j.items || [];
  /* these sites show a bot check to some Cloudflare data centres (GitHub runs in the USA) but not to the one serving Latvia */
  if (j.error === 'blocked' && (source === 'autoplius' || source === 'auto24' || source === 'autogidas')) { warns.push(`- ${name}: the site shows a bot check to servers (not a parsing error)`); continue; }
  /* auto24 Latvia has few cars of a given model: fewer than 3 is not an error there */
  if (source === 'auto24' && extra.cc === 'LV' && j.ok === false && j.error === 'parse_failed') { warns.push(`- ${name}: no ads of this model standing in Latvia today`); continue; }
  if (!j.ok || its.length < 3) { bad(`comps ${name}`, (j.error || '') + ' items ' + its.length); continue; }
  const full = its.filter(i => i.price > 0 && i.year && i.url).length / its.length;
  const km = its.filter(i => i.km != null).length / its.length;
  const offY = its.filter(i => i.year && Math.abs(i.year - year) > 1).length / its.length;
  if (full < 0.9) bad(`comps ${name}`, `only ${Math.round(full * 100)}% items have price+year+link`);
  else if (km < 0.6) bad(`comps ${name}`, `only ${Math.round(km * 100)}% items have mileage`);
  else if (source !== 'ss' && offY > 0.2) bad(`comps ${name}`, `${Math.round(offY * 100)}% items outside the year filter`);
  else good(`comps ${name}: ${its.length}`);
}

// 4. listing pages of other sites (first comparable of each)
for (const [source, extra] of [['autoplius', {}], ['autoportaal', {}], ['auto24', { cc: 'EE' }], ['as24', { cy: 'D' }]]) {
  const j = await get('/api/comps', Object.assign({ source, make: 'Volkswagen', model: 'Golf', year: 2018 }, extra));
  const it = (j.items || [])[0]; if (!it) continue;
  const l = await get('/api/listing', { url: it.url });
  const L = l.listing || {};
  const miss = (source === 'as24' || source === 'autoportaal' || source === 'auto24' ? ['make', 'model', 'year', 'asking_price', 'mileage_km', 'fuel', 'gearbox', 'engine_l'] : ['make', 'year', 'asking_price']).filter(k => L[k] == null);
  if (source === 'as24' && L.model && L.make && L.model === L.make) miss.push('model=make');
  if (miss.length) bad(`listing ${source} ${it.url}`, 'not read: ' + miss.join(', ') + (l.error ? ' (' + l.error + ')' : ''));
  else good(`listing ${source}: ok`);
}

// 5. salvage auction history by VIN (a known Copart lot)
{ const j = await get('/api/vinhist', { vin: 'WBA8E1C58JA756430' }); const l = (j.lots || [])[0] || {};
  if (!j.ok || !j.found || !l.damage || !l.photos || !l.photos.length) bad('vin history', (j.error || 'not found / no damage or photos')); else good('vin history: ' + l.source + ' ' + l.damage + ', photos ' + l.photos.length); }

// 6. a buyer in Latvia looking at a car in Germany: the German ad is read, and both Germany and Latvia have comparables for it
{
  const j = await get('/api/comps', { source: 'as24', cy: 'D', make: 'Audi', model: 'A6', year: 2018 });
  const it = (j.items || []).find(i => i.url);
  if (!it) bad('foreign ad flow', 'no German Audi A6 ads found');
  else {
    const l = (await get('/api/listing', { url: it.url })).listing || {};
    const y = l.year || 2018;
    const de = await get('/api/comps', { source: 'as24', cy: 'D', make: l.make || 'Audi', model: l.model || 'A6', year: y });
    const lv = await get('/api/comps', { source: 'ss', make: l.make || 'Audi', model: l.model || 'A6', year: y });
    if (!l.asking_price || !l.year) bad('foreign ad flow', 'German ad not read: ' + it.url);
    else if (!de.ok || (de.items || []).length < 5) bad('foreign ad flow', 'too few German comparables for its own market: ' + (de.items || []).length);
    else if (!lv.ok || (lv.items || []).length < 5) bad('foreign ad flow', 'too few Latvian comparables to show next to it: ' + (lv.items || []).length);
    else good(`foreign ad flow: German ad read, ${de.items.length} German and ${lv.items.length} Latvian comparables`);
  }
}

// 7. names from the make/model picker are found on the sites (a different sample every day)
{
  let cat = null;
  try { const html = await (await fetch('https://digitalcreatorhub.github.io/carscout/?r=' + Date.now(), { signal: AbortSignal.timeout(30000) })).text(); const m = html.match(/var MODEL_CAT=(\{.*?\});\n/); if (m) cat = JSON.parse(m[1]); } catch (e) { }
  if (!cat) bad('picker catalogue', 'MODEL_CAT not found on the live page');
  else {
    const POP = ['Volkswagen', 'Toyota', 'Audi', 'BMW', 'Škoda', 'Mercedes-Benz', 'Volvo', 'Opel', 'Ford', 'Peugeot', 'Renault', 'Nissan', 'Kia', 'Hyundai', 'Mazda', 'Honda', 'Lexus', 'Subaru', 'Tesla', 'Citroën'];
    const day = Math.floor(Date.now() / 86400000), pairs = [];
    POP.forEach((mk, i) => { const ms = (cat[mk] || []).filter(m => !/^\d{2,3}$/.test(m)); if (ms.length) pairs.push([mk, ms[(day + i * 7) % ms.length]]); });
    const sample = pairs.filter((_, i) => (i + day) % 2 === 0).slice(0, 10);
    let found = 0; const miss = [];
    for (const [mk, md] of sample) {
      const r = [];
      for (const [source, extra] of [['ss', {}], ['autoportaal', {}], ['as24', { cy: 'D' }]]) { const j = await get('/api/comps', Object.assign({ source, make: mk, model: md, year: '' }, extra)); r.push(j.ok && (j.items || []).length ? source : null); }
      if (r.some(Boolean)) found++; else miss.push(`${mk} ${md}`);
    }
    if (miss.length) bad('picker names', 'not found on ss.lv, autoportaal.ee or AutoScout24: ' + miss.join(', '));
    else good(`picker names: ${found} of ${sample.length} sampled models found`);
  }
}

// 8. "Find me a car" phone notifications: the keys and the checking queue answer
{
  const k = await get('/api/push/key', {}); const t = await get('/api/push/tick', {}, 120000);
  if (!k.ok || !k.key) bad('push key', k.error || 'no key'); else if (!t.ok) bad('push tick', t.error || JSON.stringify(t)); else good('push: key and queue ok' + (t.idle ? ' (nothing to check)' : ' (checked ' + t.part + ')'));
}

// 9. the published page is the latest version from the repository
try {
  const fsx = await import('node:fs'); const local = (fsx.readFileSync('index.html', 'utf8').match(/APP_VER = '([^']+)'/) || [])[1];
  const live = ((await (await fetch('https://digitalcreatorhub.github.io/carscout/?r=' + Date.now(), { signal: AbortSignal.timeout(30000) })).text()).match(/APP_VER = '([^']+)'/) || [])[1];
  if (local && live !== local) bad('site version', `live ${live}, repository ${local}`); else good('site version: ' + live);
} catch (e) { warns.push('- site version: ' + e.message); }

const date = new Date().toISOString().slice(0, 10);
const report = `## CarScout self-check ${date}\n\n${fails.length ? `### Problems (${fails.length})\n${fails.join('\n')}\n\n` : '**All checks passed.**\n\n'}${warns.length ? `### Warnings\n${warns.join('\n')}\n\n` : ''}### Passed\n${oks.join('\n')}\n`;
console.log(report);
const fs = await import('node:fs');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
fs.writeFileSync('selfcheck-report.md', report);
fs.writeFileSync('selfcheck-failed.txt', fails.length ? '1' : '0');
