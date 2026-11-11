import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('out', { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
let n = 0;
async function get(u) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru,lv;q=0.8' } });
  const t = await r.text(); n++;
  writeFileSync(`out/${String(n).padStart(2, '0')}_${u.replace(/^https:\/\/www\.ss\.com\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 90)}.html`, t);
  console.log(r.status, u, t.length);
  await new Promise(s => setTimeout(s, 1200));
  return t;
}
const links = (t, re) => [...new Set([...t.matchAll(/href="([^"#]+)"/g)].map(m => m[1]).filter(h => re.test(h)))];
const root = await get('https://www.ss.com/ru/transport/moto-transport/');
const subs = links(root, /^\/ru\/transport\/moto-transport\/[a-z0-9-]+\/$/);
console.log('SUBS', subs.join(' '));
for (const s of subs) {
  const t = await get('https://www.ss.com' + s);
  const makes = links(t, new RegExp('^' + s + '[a-z0-9-]+/$'));
  console.log('MAKES', s, makes.join(' '));
  const ads = links(t, /^\/msg\//);
  console.log('ADS', s, ads.slice(0, 5).join(' '));
}
const want = ['/ru/transport/moto-transport/motorcycles/', '/ru/transport/moto-transport/quad-bikes/'];
for (const s of subs.filter(x => /motorcycle|quad|atv|kvadr/i.test(x))) {
  const t = await get('https://www.ss.com' + s);
  const makes = links(t, new RegExp('^' + s + '[a-z0-9-]+/$'));
  for (const mk of makes.filter(m => /honda|yamaha|cf-?moto|can-?am|bmw|ktm|others|cits/.test(m)).slice(0, 4)) {
    const lt = await get('https://www.ss.com' + mk);
    const models = links(lt, new RegExp('^' + mk + '[a-z0-9-]+/$'));
    console.log('MODELS', mk, models.slice(0, 30).join(' '));
    const ads = links(lt, /^\/msg\//).slice(0, 2);
    for (const a of ads) await get('https://www.ss.com' + a);
    if (models[0]) { const mt = await get('https://www.ss.com' + models[0]); for (const a of links(mt, /^\/msg\//).slice(0, 1)) await get('https://www.ss.com' + a); }
  }
}
const fp = await get('https://www.ss.com/ru/transport/moto-transport/motorcycles/honda/filter/');
