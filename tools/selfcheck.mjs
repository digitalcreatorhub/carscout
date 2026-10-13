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
  if (it) { const s = await get('/api/seller', { url: it.url }); if (!s.ok || s.views == null) bad('ss seller', s.error || 'no views'); else good(`ss seller: views ${s.views}, cars ${s.carAds}`); }
}

// 3. comparables on every market
const MODELS = [['Volkswagen', 'Golf', 2018, 'petrol'], ['Toyota', 'RAV4', 2019, ''], ['Volkswagen', 'Arteon', 2020, 'diesel']];
const SRC = [['ss', {}], ['autoplius', {}], ['as24', { cy: 'D' }], ['as24', { cy: 'B' }], ['as24', { cy: 'NL' }], ['as24', { cy: 'F' }]];
for (const [make, model, year, fuel] of MODELS) for (const [source, extra] of SRC) {
  if (source === 'autoplius' && model !== 'Golf') continue; // autoplius limits bursts of requests
  const name = `${source}${extra.cy ? ' ' + extra.cy : ''} ${make} ${model}`;
  const j = await get('/api/comps', Object.assign({ source, make, model, year, fuel }, extra));
  const its = j.items || [];
  if (j.error === 'blocked' && source === 'autoplius') { warns.push(`- ${name}: the site shows a bot check to servers (not a parsing error)`); continue; }
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
for (const [source, extra] of [['autoplius', {}], ['as24', { cy: 'D' }]]) {
  const j = await get('/api/comps', Object.assign({ source, make: 'Volkswagen', model: 'Golf', year: 2018 }, extra));
  const it = (j.items || [])[0]; if (!it) continue;
  const l = await get('/api/listing', { url: it.url });
  const L = l.listing || {};
  const miss = (source === 'as24' ? ['make', 'model', 'year', 'asking_price', 'mileage_km', 'fuel', 'gearbox', 'engine_l'] : ['make', 'year', 'asking_price']).filter(k => L[k] == null);
  if (source === 'as24' && L.model && L.make && L.model === L.make) miss.push('model=make');
  if (miss.length) bad(`listing ${source} ${it.url}`, 'not read: ' + miss.join(', ') + (l.error ? ' (' + l.error + ')' : ''));
  else good(`listing ${source}: ok`);
}

// 5. salvage auction history by VIN (a known Copart lot)
{ const j = await get('/api/vinhist', { vin: 'WBA8E1C58JA756430' }); const l = (j.lots || [])[0] || {};
  if (!j.ok || !j.found || !l.damage || !l.photos || !l.photos.length) bad('vin history', (j.error || 'not found / no damage or photos')); else good('vin history: ' + l.source + ' ' + l.damage + ', photos ' + l.photos.length); }
const date = new Date().toISOString().slice(0, 10);
const report = `## CarScout self-check ${date}\n\n${fails.length ? `### Problems (${fails.length})\n${fails.join('\n')}\n\n` : '**All checks passed.**\n\n'}${warns.length ? `### Warnings\n${warns.join('\n')}\n\n` : ''}### Passed\n${oks.join('\n')}\n`;
console.log(report);
const fs = await import('node:fs');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
fs.writeFileSync('selfcheck-report.md', report);
fs.writeFileSync('selfcheck-failed.txt', fails.length ? '1' : '0');
