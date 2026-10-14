// Daily market walk: asks the CarScout worker for the listings of popular models so that CarScout memory
// (price history and the price index) fills up even for models nobody checked today.
// Gentle: one model at a time with a pause; the worker caches every page.
const W = process.env.WORKER || 'https://carscout.pmax70095.workers.dev';
const H = { origin: 'https://digitalcreatorhub.github.io' };
const MODELS = [
  ['Volkswagen', 'Golf'], ['Volkswagen', 'Passat'], ['Volkswagen', 'Tiguan'], ['Volkswagen', 'Touran'], ['Volkswagen', 'Polo'], ['Volkswagen', 'Sharan'], ['Volkswagen', 'Touareg'],
  ['Škoda', 'Octavia'], ['Škoda', 'Superb'], ['Škoda', 'Fabia'], ['Škoda', 'Kodiaq'], ['Škoda', 'Karoq'],
  ['Toyota', 'RAV4'], ['Toyota', 'Corolla'], ['Toyota', 'Avensis'], ['Toyota', 'Auris'], ['Toyota', 'Yaris'], ['Toyota', 'Land Cruiser'],
  ['Audi', 'A4'], ['Audi', 'A6'], ['Audi', 'A3'], ['Audi', 'Q5'], ['Audi', 'Q7'],
  ['Volvo', 'XC60'], ['Volvo', 'XC90'], ['Volvo', 'V60'], ['Volvo', 'V40'], ['Volvo', 'V70'],
  ['Ford', 'Focus'], ['Ford', 'Mondeo'], ['Ford', 'Kuga'], ['Opel', 'Astra'], ['Opel', 'Insignia'], ['Opel', 'Zafira'],
  ['Honda', 'CR-V'], ['Honda', 'Civic'], ['Nissan', 'Qashqai'], ['Nissan', 'X-Trail'], ['Kia', 'Sportage'], ['Kia', 'Ceed'],
  ['Hyundai', 'Tucson'], ['Hyundai', 'i30'], ['Mazda', '6'], ['Mazda', 'CX-5'], ['Peugeot', '308'], ['Renault', 'Megane'], ['Subaru', 'Forester'], ['Mitsubishi', 'Outlander']
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, params) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 70000);
  try { const r = await fetch(W + path + '?' + new URLSearchParams(params), { headers: H, signal: ctl.signal }); return await r.json(); }
  catch (e) { return { ok: false, error: String(e) }; } finally { clearTimeout(t); }
}
let total = 0, okN = 0;
for (const [make, model] of MODELS) {
  for (const source of ['ss', 'autoportaal']) {
    const j = await get('/api/comps', { source, make, model });
    const n = (j.items || []).length; total += n; if (j.ok) okN++;
    console.log(source.padEnd(12), make, model, j.ok ? n : 'error ' + (j.error || ''));
    await sleep(2500);
  }
}
console.log('done: requests ok', okN, 'listings seen', total);
