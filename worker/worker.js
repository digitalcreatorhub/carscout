/**
 * CarScout Live: Cloudflare Worker.
 * Reads car listings and search results from public marketplace pages on the server side
 * (so the browser CORS rule does not apply) and returns clean JSON to the CarScout web page.
 *
 * Endpoints (all GET, JSON):
 *   /                       status and version
 *   /api/listing?url=       facts from one listing page
 *   /api/comps?source=ss|as24de&make=&model=&year=&ssPath=
 *                           real similar listings from ss.com (Latvia) or AutoScout24 (Germany)
 *   /api/search?url=        any pasted search results page (autoplius, auto24, otomoto, ...)
 *   /api/debug?url=         what the worker actually received (use it when a site stops working)
 *
 * Settings (Workers > your worker > Settings > Variables):
 *   ALLOW_ORIGIN  optional, e.g. https://yourname.github.io  (default: any origin)
 */
const VERSION = '1.0.0';

const HOSTS = [
  /(^|\.)ss\.(com|lv)$/, /(^|\.)autoplius\.lt$/, /(^|\.)autogidas\.lt$/, /(^|\.)auto24\.(ee|lv|lt|fi|ru)$/,
  /(^|\.)autoscout24\.[a-z.]+$/, /(^|\.)mobile\.de$/, /(^|\.)otomoto\.pl$/, /(^|\.)autovit\.ro$/, /(^|\.)kleinanzeigen\.de$/, /(^|\.)autoportaal\.ee$/
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAKES = ['Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Citroën', 'Citroen', 'Cupra', 'Dacia', 'DS', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Infiniti',
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Mazda', 'Mercedes-Benz', 'Mercedes', 'MINI', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Polestar', 'Porsche',
  'Renault', 'SEAT', 'Seat', 'Škoda', 'Skoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo', 'Chevrolet', 'Chrysler', 'Dodge', 'Saab', 'Lancia', 'GWM','Great Wall','Ora','BYD','Chery','Geely','MG','Lynk & Co','NIO','XPeng','Zeekr','Leapmotor','Haval','Omoda','Jaecoo','Dongfeng','Voyah','Maxus','Lotus','SsangYong','KGM','Isuzu','Lada','UAZ','GAZ','Iveco','Cadillac','Lincoln','Buick','GMC','RAM','Hummer','Abarth','Alpine','Maserati','Ferrari','Lamborghini','Rolls-Royce','McLaren','Genesis','Daihatsu','Daewoo','Rover','Aiways','Fisker','Lucid','Rivian','Seres','Skywell','Togg','ZAZ','Moskvich','Tata','Mahindra','Proton','Bugatti','Pontiac','Plymouth','Mercury','Acura','Scion','Datsun','Morgan','Tatra','Wartburg','Trabant','Iran Khodro','DR','Xev','Microcar','Aixam','Ligier','Piaggio','Vauxhall','Holden','BAIC','JAC'];

/* ---------------- HTTP helpers ---------------- */
function cors(env) {
  return {
    'access-control-allow-origin': (env && env.ALLOW_ORIGIN) || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-carscout-auth',
    'access-control-max-age': '86400'
  };
}
function json(env, data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors(env)) });
}
function allowed(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && HOSTS.some(function (re) { return re.test(x.hostname); });
  } catch (e) { return false; }
}
async function getPage(url, ttl) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9,lv;q=0.8,ru;q=0.7,de;q=0.6' },
    redirect: 'follow',
    cf: { cacheTtlByStatus: { '200-299': ttl || 900, '404': ttl || 900, '300-399': 0, '400-403': 0, '405-599': 0 }, cacheEverything: true }
  });
  const buf = await r.text();
  return { status: r.status, url: r.url || url, text: buf.length > 3000000 ? buf.slice(0, 3000000) : buf };
}
function blockedBy(p) {
  if ([401, 403, 407, 429, 503].indexOf(p.status) > -1) return 'HTTP ' + p.status;
  const head = p.text.slice(0, 6000);
  if (p.text.length < 80000 && /captcha|cf-chl|just a moment|access denied|pardon our interruption|are you a human|bot detection/i.test(head)) return 'anti-bot page';
  return null;
}

/* ---------------- text helpers ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', scaron: 'š', Scaron: 'Š' };
function dec(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
    if (e.charAt(0) === '#') {
      const c = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return c ? String.fromCodePoint(c) : m; } catch (x) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : (Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m);
  });
}
function strip(h) {
  return dec(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toNum(s) {
  if (typeof s === 'number') return isFinite(s) ? s : null;
  s = String(s == null ? '' : s).replace(/[   \s]/g, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return parseInt(s.replace(/[.,]/g, ''), 10);
  const n = parseFloat(s.replace(',', '.'));
  return isFinite(n) ? n : null;
}
function absUrl(href, base) { try { return new URL(dec(href), base).href; } catch (e) { return null; } }
function meta(html, prop) {
  const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? dec(m[1]) : null;
}
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function cleanMakeModel(make, model) {
  let mk = String(make || '').trim(), md = String(model || '').trim();
  const rv = mk.match(/^(?:land[\s\-]*)?rover\s+(range\s+rover.*|discovery.*|defender.*|freelander.*)$/i); if (rv) { mk = 'Land Rover'; if (!md) md = rv[1].trim(); }
  if (/^(?:land[\s\-]*)?rover$/i.test(mk) && /range|discovery|defender|freelander|evoque|velar/i.test(md)) mk = 'Land Rover';
  let best = null;
  MAKES.forEach(function (m) { if (mk.toLowerCase().indexOf(m.toLowerCase()) === 0 && (!best || m.length > best.length)) best = m; });
  if (best) {
    const rest = mk.slice(best.length).replace(/^[\s,\-–:]+/, '').trim();
    if (rest && !md) md = multiModel(rest) || rest.split(/\s+/)[0];
    if (/^ora$/i.test(best) && !md) md = 'Ora';
    best = normMakeName(best);
    mk = best;
  }
  const re = new RegExp('^' + mk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
  if (md && mk) md = md.replace(re, '');
  return { make: mk || null, model: md || null };
}
function as24Model(mk, md) {
  // AutoScout24 names Mercedes models like "e-350", "c-220", "gle-350"; most other makes keep the plain model name.
  if (mk === 'mercedes-benz') { const m = md.match(/^([a-z]{1,4})-?(\d{2,3})(?:-?[a-z]+)?$/); if (m) return m[1] + '-' + m[2]; }
  if (mk === 'bmw') { const m = md.match(/^(\d{3})[a-z]*$/); if (m) return m[1]; }
  return md;
}
var MAKE_BOUNDED={'GW':1,'MG':1,'NIO':1,'Ora':1,'BYD':1,'GWM':1,'DS':1,'Lynk & Co':1,'Haval':1,'Omoda':1,'Jaecoo':1,'Lotus':1,'Chery':1,'Geely':1,'Zeekr':1,'XPeng':1,'Leapmotor':1,'Dongfeng':1,'Voyah':1,'Maxus':1,'Great Wall':1};
function normMakeName(mk){
  if(/^vw$/i.test(mk)) return 'Volkswagen'; if(/^citroen$/i.test(mk)) return 'Citroën'; if(/^skoda$/i.test(mk)) return 'Škoda'; if(/^mercedes$/i.test(mk)) return 'Mercedes-Benz';
  if(/^(great wall|gw|ora)$/i.test(mk)) return 'GWM'; if(/^xpeng$/i.test(mk)) return 'XPeng'; return mk;
}
function findMake(t){
  var lt=String(t||'').toLowerCase(), best=null;
  MAKES.forEach(function(mk){
    var l=mk.toLowerCase(), i=-1;
    if(MAKE_BOUNDED[mk]){ var m=new RegExp('(^|[^a-z0-9])'+l.replace(/[.*+?^${}()|[\]\\&]/g,'\\$&')+'(?![a-z0-9])').exec(lt); if(m) i=m.index+m[1].length; }
    else i=lt.indexOf(l);
    if(i>-1&&(!best||i<best.i||(i===best.i&&mk.length>best.mk.length))) best={mk:mk,i:i};
  });
  return best;
}
function multiModel(rest){
  var r=String(rest||''), m, cap=function(s){ return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); };
  if((m=r.match(/^model[\s\-]?([3sxy])(?![A-Za-z0-9])/i))) return 'Model '+m[1].toUpperCase();
  if(/^ora(?![a-z0-9])/i.test(r)) return 'Ora';
  if(/^cyber[\s\-]?truck/i.test(r)) return 'Cybertruck';
  if((m=r.match(/^range[\s\-]?rover(?:[\s\-]+(sport|evoque|velar))?(?![A-Za-z0-9])/i))) return 'Range Rover'+(m[1]?' '+cap(m[1]):'');
  if(/^discovery[\s\-]?sport/i.test(r)) return 'Discovery Sport';
  if((m=r.match(/^land[\s\-]?cruiser(?:[\s\-]+(prado))?/i))) return 'Land Cruiser'+(m[1]?' Prado':'');
  if(/^santa[\s\-]?fe/i.test(r)) return 'Santa Fe';
  if(/^grand[\s\-]+c-?max/i.test(r)) return 'Grand C-Max';
  if((m=r.match(/^grand[\s\-]+(cherokee|vitara|scenic|espace|modus|touran)/i))) return 'Grand '+cap(m[1]);
  if((m=r.match(/^id[.\s\-]?([3-9])(?![0-9])/i))) return 'ID.'+m[1];
  if((m=r.match(/^ioniq[\s\-]?([56])(?![0-9])/i))) return 'Ioniq '+m[1];
  if(/^mustang[\s\-]+mach[\s\-]?e/i.test(r)) return 'Mustang Mach-E';
  return null;
}
function guessMakeModel(title) {
  const t = String(title || '');
  const best = findMake(t);
  if (!best) return { make: null, model: null };
  { const lt = t.toLowerCase(), lm = best.mk.toLowerCase(); let p = best.i; while (p > -1) { if (multiModel(t.slice(p + lm.length).replace(/^[\s,\-–:]+/, ''))) { best.i = p; break; } p = lt.indexOf(lm, p + 1); } }
  const rest = t.slice(best.i + best.mk.length).replace(/^[\s,\-–:]+/, '');
  const mm = rest.match(/^([A-Za-z0-9ČčŠšŽžĀāĒēĪīŪū][A-Za-z0-9ČčŠšŽžĀāĒēĪīŪū\-]*)/);
  const make = normMakeName(best.mk);
  const rest2 = best.mk === 'Ora' ? 'Ora ' + rest : rest;
  return { make: make, model: multiModel(rest2) || (mm ? mm[1] : null) };
}

/* ---------------- field parsers (shared logic) ---------------- */
function parseEngine(v) {
  v = String(v || '');
  const o = {};
  const m = v.match(/(\d)[.,](\d)/);
  if (m) o.engine_l = parseFloat(m[1] + '.' + m[2]);
  const f = v.match(/(\d[.,]\d)\s*([A-Za-zА-Яа-я])/);
  const w = v.toLowerCase();
  if (/diesel|d[iī]ze[lļ]|дизел|(\d[.,]\d)\s*d\b/i.test(v)) o.fuel = 'diesel';
  else if (/hibrīd|гибрид|hybrid|(\d[.,]\d)\s*h\b/i.test(v)) o.fuel = 'hybrid';
  else if (/elektr|электр|electric|(\d[.,]\d)\s*e\b/i.test(v)) o.fuel = 'electric';
  else if (/benz|бензин|petrol|gasoline/.test(w)) o.fuel = 'petrol';
  else if (/gāze|газ|\blpg\b/.test(w)) o.fuel = 'lpg';
  else if (m && !f) o.fuel = 'petrol';
  return o;
}
/* The fuel is taken from the FIRST fuel word in a short text (title/description), never from a whole page:
   a page can mention other fuels in menus and ads. Petrol + LPG together is a petrol car converted to gas. */
function fuelEarliest(s) {
  s = String(s || '');
  const pats = [
    ['diesel', /diesel|d[iī]ze[lļ]|дизел|dizel|\b(?:tdi|cdi|hdi|dci|cdti|crdi|tdci|bluetec|d-?4d)\b/i],
    ['hybrid', /hybrid|hibrīd|гибрид/i],
    ['electric', /\belectric(?:al)?\s+(?:car|vehicle|motor|drive)|\bfully\s+electric|\belektro(?:auto|mobil\w*|motors)?\b|\belektriskais\b|\belektroauto|\belektromobil|электромобил|\bэлектро\b|электрокар|\bBEV\b/i],
    ['petrol', /petrol|benz|бензин|gasoline|\b(?:tsi|tfsi|fsi|gdi|vvt-?i|mpi)\b/i],
    ['lpg', /\blpg\b|gāze|gaze|газ/i]
  ];
  let best = null, hasPetrol = false, hasLpg = false;
  pats.forEach(function (p) {
    const m = p[1].exec(s); if (!m) return;
    if (p[0] === 'petrol') hasPetrol = true; if (p[0] === 'lpg') hasLpg = true;
    if (!best || m.index < best.i) best = { k: p[0], i: m.index };
  });
  if (!best) return null;
  if (best.k === 'lpg' && hasPetrol) return 'petrol';
  if (best.k === 'petrol' && hasLpg) return 'petrol';
  return best.k;
}
function hasLpg(s) { return /\blpg\b|(^|[^а-яёa-z])газ(?![а-яё])|(^|[^а-яё])газов\w*\s+(?:оборуд|установк|баллон)|(^|[^а-яё])гбо(?![а-яё])|(^|[^a-zāēīūčšž])gāz(?:e|es|i)(?![a-zāēīūčšž])|\bhbo\b|пропан|propān/i.test(String(s || '')); }
function normFuel(s) {
  s = String(s || '').toLowerCase();
  if (/diesel|d[iī]ze[lļ]|дизел|\bd\b/.test(s)) return 'diesel';
  if (/hybrid|hibrīd|гибрид/.test(s)) return 'hybrid';
  if (/electr|elektr|электр/.test(s)) return 'electric';
  if (/lpg|gāze|газ/.test(s)) return 'lpg';
  if (/petrol|benz|бензин|gasoline|otto/.test(s)) return 'petrol';
  return null;
}
function normGear(s) {
  s = String(s || '').toLowerCase();
  if (/automat|automāt|автомат|dsg|tiptronic|steptronic/.test(s)) return 'automatic';
  if (/manual|manuāl|механ|ручн|handschalt|schalt|mehānisk/.test(s)) return 'manual';
  return null;
}
function parseKm(v) {
  v = String(v || '');
  const m = v.match(/(\d{1,3}(?:[ ., ]\d{3})+|\d+(?:[.,]\d+)?)\s*(тыс\.?|tūkst\.?|tkm|k\b)?/i);
  if (!m) return null;
  let n = toNum(m[1]);
  if (n == null) return null;
  if (m[2] && n < 2000) n *= 1000;
  return Math.round(n);
}
function parseYear(v) {
  const m = String(v || '').match(/\b(19[89]\d|20[0-3]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}
function vinIn(text) {
  const re = /\b([A-HJ-NPR-Z0-9]{17})\b/g;
  let m;
  while ((m = re.exec(String(text || '').toUpperCase()))) {
    const s = m[1];
    if ((s.match(/\d/g) || []).length >= 5 && (s.match(/[A-Z]/g) || []).length >= 4) return s;
  }
  return null;
}
function parseText(text) {
  const t = String(text || '');
  const out = {};
  const P = t.match(/(?<![\d.,])(\d{1,3}(?:[ ., ]\d{3})+|\d{3,6})\s*(?:€|eur\b|euro)/i) || t.match(/(?:€|eur)\s*(\d{1,3}(?:[ ., ]\d{3})+|\d{3,6})/i) ||
    t.match(/(?:cena|цена|price|preis)[:\s]*(\d{1,3}(?:[ ., ]\d{3})+|\d{3,6})/i);
  if (P) { const n = toNum(P[1]); if (n >= 300 && n <= 500000) out.price = n; }
  const K = t.match(/(?:nobraukums|пробег|mileage|kilometerstand|l[aä]bis[oõ]it)[^0-9]{0,12}(\d{1,3}(?:[ ., ]\d{3})+|\d+)\s*(тыс|tūkst|tkm)?/i) ||
    t.match(/(?<![\d.,])(\d{1,3}(?:[ ., ]\d{3})+|\d{2,7})\s*(тыс\.?\s*)?(?:km|км|tkm)\b/i);
  if (K) { let n = toNum(K[1]); if (n != null) { if (K[2] && n < 2000) n *= 1000; if (n >= 0 && n <= 1500000) out.km = Math.round(n); } }
  const Y = t.match(/(?:gads|год выпуска|year|baujahr|erstzulassung|first registration|registreerimine|aasta|izlaiduma)[^0-9]{0,20}(?:\d{1,2}[\/.\-])?(19[89]\d|20[0-3]\d)/i) || t.match(/\b(19[89]\d|20[0-2]\d)\b/);
  if (Y) out.year = parseInt(Y[1], 10);
  const v = vinIn(t); if (v) out.vin = v;
  const f = fuelEarliest(t.slice(0, 3000)); if (f) out.fuel = f;
  const g = normGear(t); if (g) out.gearbox = g;
  return out;
}

/* ---------------- JSON-LD / Next.js data ---------------- */
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { const j = JSON.parse(m[1].trim()); (function flat(x) { if (Array.isArray(x)) x.forEach(flat); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) flat(x['@graph']); if (x.itemListElement) flat(x.itemListElement); if (x.item) flat(x.item); } })(j); } catch (e) { /* ignore */ }
  }
  return out;
}
function nextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function pick(o, path) { let c = o; for (let i = 0; i < path.length; i++) { if (c == null) return undefined; c = c[path[i]]; } return c; }
function itemFromObj(o, base) {
  if (!o || typeof o !== 'object') return null;
  let price = pick(o, ['tracking', 'price']);
  if (price == null) price = pick(o, ['price', 'priceRaw']);
  if (price == null && o.price && typeof o.price === 'object') price = o.price.priceFormatted || o.price.value || o.price.amount;
  if (price == null && o.offers) price = o.offers.price || (o.offers[0] && o.offers[0].price);
  if (price == null && (typeof o.price === 'number' || typeof o.price === 'string')) price = o.price;
  price = toNum(price);
  if (!(price >= 300 && price <= 500000)) return null;
  let km = pick(o, ['tracking', 'mileage']);
  if (km == null) km = pick(o, ['vehicle', 'mileageInKm']);
  if (km == null) km = o.mileageInKm != null ? o.mileageInKm : (o.mileage != null ? o.mileage : pick(o, ['mileageFromOdometer', 'value']));
  if (km != null && typeof km === 'object') km = km.value != null ? km.value : null;
  km = km == null ? null : parseKm(String(km));
  let vdFuel = null, vdYear = null;
  if (Array.isArray(o.vehicleDetails)) {
    // AutoScout24 card details: [{iconName:'mileage_road', data:'154,752 km'}, {iconName:'calendar', data:'06/2018'}, ...]
    o.vehicleDetails.forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      const n = String(d.iconName || d.icon || d.name || '').toLowerCase(), v = d.data != null ? d.data : d.value;
      if (/mileage|road|odometer|speedometer/.test(n) && (km == null || km === 0)) km = parseKm(String(v));
      else if (/calendar|registration/.test(n) && vdYear == null) vdYear = parseYear(String(v));
      else if (/gas|fuel/.test(n) && !vdFuel) vdFuel = normFuel(String(v));
    });
  }
  if (km == null || km === 0) {
    let mm; try { mm = JSON.stringify(o).match(/"(?:mileage\w*|mileageInKm|odometer\w*)"\s*:\s*"?([\d.,\s]{3,12})/i); } catch (e) { mm = null; }
    if (mm) { const k2 = parseKm(mm[1]); if (k2 != null && k2 > 0) km = k2; }
  }
  let year = pick(o, ['tracking', 'firstRegistration']);
  if (year == null) year = pick(o, ['vehicle', 'firstRegistrationDate']);
  if (year == null) year = o.firstRegistration || o.productionDate || o.vehicleModelDate || o.dateVehicleFirstRegistered || o.year;
  year = parseYear(year) || vdYear;
  const href = o.url || o.href || pick(o, ['link', 'url']);
  const title = [pick(o, ['vehicle', 'make']) || o.make, pick(o, ['vehicle', 'model']) || o.model, pick(o, ['vehicle', 'modelVersionInput']) || o.name].filter(Boolean).join(' ');
  return { price: Math.round(price), km: km, year: year, url: href ? absUrl(href, base) : null, title: strip(title || ''), fuel: normFuel(pick(o, ['vehicle', 'fuelType']) || o.fuelType || '') || vdFuel };
}
function walkListings(node, base, out, depth) {
  if (!node || depth > 14) return;
  if (Array.isArray(node)) {
    if (node.length && node.every(function (x) { return x && typeof x === 'object'; })) {
      const items = [];
      node.forEach(function (x) { if (x.price != null || x.tracking || x.offers) { const it = itemFromObj(x, base); if (it) items.push(it); } });
      if (items.length >= Math.max(2, node.length * 0.5)) { items.forEach(function (i) { out.push(i); }); return; }
    }
    node.forEach(function (x) { walkListings(x, base, out, depth + 1); });
    return;
  }
  if (typeof node === 'object') Object.keys(node).forEach(function (k) { walkListings(node[k], base, out, depth + 1); });
}

/* ---------------- site parsers ---------------- */
const SS_LABELS = [
  ['make', /^(marka|марка|make|brand)$/], ['model', /^(modelis|модель|model)$/], ['year', /^(izlaiduma gads|год выпуска|year|year of issue|year of manufacture)$/],
  ['engine', /^(dzin[eē]js|dzin[eē]ja tips|motors|двигатель|мотор|тип двигателя|engine|engine type|type of engine|motor)$/], ['gearbox', /^([aā]trumk[aā]rba|коробка передач|коробка|transmission|gearbox|gear box)$/],
  ['mileage', /^(nobraukums|пробег|mileage|run|odometer)$/], ['color', /^(kr[aā]sa|цвет|colou?r)$/], ['body', /^(virsb[uū]ves tips|тип кузова|body type)$/],
  ['vin', /^(vin|vin kods|vin код|vin code)$/]
];
/* The ad text sits in #msg_div_msg together with the photo gallery (nested divs), so we cannot stop at the first </div>.
   Take everything up to the options table (or the footer markers) instead. */
function ssDescription(html) {
  const m = /id=["']msg_div_msg["'][^>]*>/i.exec(html);
  if (!m) return '';
  const start = m.index + m[0].length;
  let end = start + 30000;
  [/<table[^>]*class=["'][^"']*options_list/i, /class=["']ads_opt_name["']/i, /id=["']msg_div_msg_end/i, /class=["'](?:msg_footer|ads_contacts|d1)["']/i, /id=["']contacts_table/i].forEach(function (re) {
    const sub = html.slice(start, end); const x = re.exec(sub);
    if (x && x.index > 40) end = start + x.index;
  });
  return strip(html.slice(start, end)).slice(0, 8000);
}
function parseSsListing(html, url) {
  const L = {};
  const re = /<td[^>]*class="ads_opt_name"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="ads_opt"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = strip(m[1]).replace(/[:,].*$/, '').trim().toLowerCase();
    const val = strip(m[2]);
    SS_LABELS.forEach(function (p) { if (p[1].test(label) && !L[p[0]]) L[p[0]] = val; });
  }
  const pm = html.match(/class="ads_price"[^>]*>([\s\S]*?)<\/(?:td|span|div)>/i);
  const price = pm ? toNum(strip(pm[1])) : null;
  const desc = ssDescription(html);
  const eng = parseEngine(L.engine || '');
  const m2 = url.match(/\/msg\/[a-z]{2}\/transport\/cars\/([^/]+)\/([^/]+)\//);
  const listing = {
    make: L.make || null, model: L.model || null, year: parseYear(L.year), mileage_km: L.mileage ? parseKm(L.mileage) : null,
    asking_price: price, fuel: eng.fuel || normFuel(L.engine) || fuelEarliest(desc.slice(0, 1200)) || null, engine_l: eng.engine_l || null, gearbox: normGear(L.gearbox), color: L.color || null,
    model_raw: L.model || null, body: L.body || null, vin: vinIn(L.vin || desc), description: desc.slice(0, 8000),
    lpg: hasLpg(L.engine || '') || hasLpg(desc.slice(0, 3000))
  };
  if (listing.fuel && listing.fuel !== 'petrol' && listing.fuel !== 'lpg' && !hasLpg(L.engine || '')) listing.lpg = false;
  listing.src = { make: L.make ? 'table' : 'text', model: (L.model || (L.make && listing.model && L.make.toLowerCase().indexOf(String(listing.model).toLowerCase()) > -1)) ? 'table' : 'text', year: L.year ? 'table' : null, mileage_km: L.mileage ? 'table' : null,
    asking_price: price ? 'table' : null, gearbox: L.gearbox ? 'table' : null, fuel: (eng.fuel || normFuel(L.engine)) ? 'table' : (listing.fuel ? 'text' : null), vin: L.vin ? 'table' : (listing.vin ? 'text' : null) };
  const OTHER_MAKE = /^((other|others)( brands?| makes?)?|cit[sai]s?( markas?)?|citi|(другая|другие|прочие|прочее|иная)( марк[аи])?|—|-)$/i;
  if (!listing.make || OTHER_MAKE.test(listing.make)) {
    const pageTitle = strip((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let g = guessMakeModel(listing.model || '');
    if (!g.make) g = guessMakeModel(pageTitle);
    if (!g.make) g = guessMakeModel(desc.slice(0, 500));
    if (g.make) { listing.make = g.make; listing.model = g.model || listing.model; } else listing.make = null;
  }
  const nm = cleanMakeModel(listing.make, listing.model); listing.make = nm.make; listing.model = nm.model;
  if (listing.make && !listing.model && /\s/.test(listing.make)) { const sp = listing.make.trim().split(/\s+/); listing.make = sp[0]; listing.model = sp.slice(1).join(' '); }
  /* ss.lv puts make and model together in the 'Marka' row, so a model taken from it is table data */
  if (listing.model && listing.src.make === 'table' && L.make && L.make.toLowerCase().indexOf(String(listing.model).toLowerCase().split(' ')[0]) > -1) listing.src.model = 'table';
  if (!listing.vin) listing.src.vin = null;
  const dt = ssDates(html); listing.posted = dt.posted; listing.updated = dt.updated; listing.ss_id = dt.id;
  const loc = ssLocation(html); listing.place = loc.place; listing.address = loc.address; listing.geo = loc.geo;
  listing.removed = !price && !L.year && !L.mileage;
  const m3 = url.match(/\/msg\/[a-z]{2}\/transport\/cars\/others\/[^/]+\.html/i);
  return { listing: listing, hints: { ss_others: !!m3, ss_path: m3 ? '/ru/transport/cars/others/' : m2 ? '/ru/transport/cars/' + m2[1] + '/' + m2[2] + '/' : null, ss_make: m2 ? m2[1] : null, ss_model: m2 ? m2[2] : null } };
}
/* ss.lv contacts block: 'Place' (city or region) and, for some sellers, 'Address' with map coordinates */
function ssLocation(html) {
  const out = { place: null, address: null, geo: null };
  const re = /<td[^>]*class="ads_contacts_name"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi; let m;
  while ((m = re.exec(html))) {
    const lab = strip(m[1]).replace(/:$/, '').trim().toLowerCase();
    if (/^(vieta|место|place)$/.test(lab) && !out.place) out.place = strip(m[2]).slice(0, 80) || null;
    if (/^(adrese|адрес|address)$/.test(lab) && !out.address) {
      out.address = strip(m[2]).slice(0, 120) || null;
      const c = m[2].match(/[?&]c=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
      if (c) { const la = parseFloat(c[1]), lo = parseFloat(c[2]); if (la > 50 && la < 60 && lo > 15 && lo < 32) out.geo = { lat: Math.round(la * 1e5) / 1e5, lon: Math.round(lo * 1e5) / 1e5 }; }
    }
  }
  return out;
}
/* ss.lv: the contacts script path carries the date the ad was first published; the footer shows the last raise date */
function ssDates(html) {
  const p = html.match(/\/js\/[a-z]{2}\/(20\d{2}-\d{2}-\d{2})\//);
  const u = html.match(/(?:Datums|Date|Дата):\s*(\d{2})\.(\d{2})\.(20\d{2})\s+(\d{2}:\d{2})/);
  const id = html.match(/value=['"](\d{6,})_\d+/);
  return { posted: p ? p[1] : null, updated: u ? u[3] + '-' + u[2] + '-' + u[1] + 'T' + u[4] : null, id: id ? id[1] : null };
}
function parseSsList(html, base) {
  const items = [];
  const rows = html.match(/<tr[^>]+id="tr_\d+"[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(function (row) {
    if (/id="tr_(bnr|b)\b/i.test(row.slice(0, 40))) return;
    const link = row.match(/<a[^>]+href="(\/(?:msg|[a-z]{2}\/msg)\/[^"]+)"/i);
    const tds = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map(strip).filter(Boolean);
    let price = null, year = null, km = null, eng = null;
    for (let i = tds.length - 1; i >= 0; i--) { if (/[€]|eur/i.test(tds[i]) && /\d/.test(tds[i])) { price = toNum(tds[i].replace(/\/.*$/, '')); break; } }
    tds.forEach(function (c) {
      if (year == null && /^(19[89]\d|20[0-3]\d)$/.test(c)) year = parseInt(c, 10);
      else if (km == null && /^\d[\d ]*\s*(тыс\.?|tūkst\.?)$/i.test(c)) km = parseKm(c);
      else if (eng == null && /^\d[.,]\d\s*[A-Za-zА-Яа-я]?$/.test(c)) eng = c;
    });
    if (km == null) tds.forEach(function (c) { if (km == null && /^\d{4,7}$/.test(c) && parseInt(c, 10) !== year) km = parseInt(c, 10); });
    if (!(price >= 300 && price <= 500000) || !year) return;
    const e = parseEngine(eng || '');
    let title = '';
    (row.match(/<a[^>]+href="\/(?:msg|[a-z]{2}\/msg)\/[^"]+"[^>]*>[\s\S]*?<\/a>/gi) || []).forEach(function (h) { const t = strip(h); if (t.length > title.length) title = t; });
    if (km == null) { const tk = title.match(/(\d{1,3}(?:[ \u00a0.]\d{3})+|\d{4,6})\s*(?:km|км)\b/i); if (tk) { const n = parseInt(tk[1].replace(/\D/g, ''), 10); if (n >= 1000 && n < 1500000) km = n; } }
    let img = null; const im = row.match(/<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i);
    if (im) { const u = absUrl(im[1].replace(/&amp;/g, '&'), base); if (u && imgAllowed(u) && !/(logo|icon|noimage|placeholder|sprite)/i.test(u)) img = u; }
    items.push({ price: Math.round(price), km: km, year: year, url: link ? absUrl(link[1], base) : null, title: title.slice(0, 160), fuel: e.fuel || null, engine_l: e.engine_l || null, img: img });
  });
  return items;
}

/* autoplius.lt list: each ad is an <a class="announcement-item"> block */
function parseAutopliusList(html, base) {
  const items = [];
  const re = /<a\s+href="(https?:\/\/[a-z.]*autoplius\.lt\/ads\/[^"]+?\.html)"\s+class="announcement-item[^"]*"/gi;
  const starts = []; let m;
  while ((m = re.exec(html))) starts.push({ i: m.index, url: m[1] });
  starts.forEach(function (s, k) {
    const block = html.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : s.i + 9000);
    const pm = block.match(/announcement-pricing-info[\s\S]*?<strong[^>]*>\s*([\d\s.,]+)\s*(?:&euro;|€)/i);
    const price = pm ? toNum(pm[1]) : null;
    if (!(price >= 300 && price <= 500000)) return;
    const t = block.match(/class="announcement-title"[^>]*>([\s\S]*?)<\/div>/i);
    const head = block.match(/class="announcement-title-parameters"[\s\S]*?<\/div>\s*<\/div>/i);
    const headSpans = head ? (head[0].match(/<span[^>]*>([\s\S]*?)<\/span>/gi) || []).map(strip) : [];
    let year = null; headSpans.forEach(function (x) { const y = x.match(/^(19[89]\d|20[0-3]\d)(?:-\d{2})?$/); if (y && !year) year = parseInt(y[1], 10); });
    const pb = block.match(/class="announcement-parameters-block"[\s\S]*?<\/div>\s*<\/div>/i);
    const ps = pb ? (pb[0].match(/<span[^>]*>([\s\S]*?)<\/span>/gi) || []).map(strip) : [];
    let km = null, fuel = null, gear = null, eng = null;
    ps.forEach(function (x) {
      if (km == null && /^\d[\d\s]*\s*km$/i.test(x)) km = parseKm(x);
      else if (!fuel && normFuel(x)) fuel = normFuel(x);
      else if (!gear && /automat|manual|mechan/i.test(x)) gear = /automat/i.test(x) ? 'automatic' : 'manual';
      else if (!eng && /\d[.,]\d\s*l/i.test(x)) eng = x;
    });
    const im = block.match(/(?:data-src|src)="(https:\/\/autoplius-img\.dgn\.lt\/[^"]+?\.(?:jpe?g|png|webp))"/i);
    const title = [t ? strip(t[1]) : '', headSpans.filter(function (x) { return !/^\d{4}(-\d{2})?$/.test(x); }).join(' '), eng || ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    items.push({ price: Math.round(price), km: km, year: year, url: s.url, title: title.slice(0, 160), fuel: fuel, gear: gear, img: im ? im[1] : null });
  });
  return items;
}
function parseAs24List(html, base) {
  const items = [];
  const re = /<article\b[^>]*data-guid=["'][^"']+["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const g = function (n) { const x = tag.match(new RegExp('data-' + n + '=["\']([^"\']*)["\']', 'i')); return x ? x[1] : null; };
    const price = toNum(g('price'));
    if (!(price >= 300)) continue;
    const endIdx = html.indexOf('</article>', m.index);
    const body = endIdx > -1 ? html.slice(m.index + tag.length, Math.min(endIdx, m.index + tag.length + 12000)) : '';
    let full = '';
    const h2 = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2) full = strip(h2[1]);
    if (!full) { const al = body.match(/<a[^>]+href="[^"]*\/offers\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i); if (al) full = strip(al[1]); }
    let img = null; const ims = body.match(/https:\/\/[a-z0-9.-]*autoscout24\.(?:net|com|de)\/[^"'\s<>]+\.(?:jpe?g|png|webp)/i);
    if (ims && imgAllowed(ims[0]) && !/(logo|icon|placeholder)/i.test(ims[0])) img = ims[0].replace(/&amp;/g, '&');
    const mmTitle = [g('make'), g('model')].filter(Boolean).join(' ');
    const title0 = (full && full.length > mmTitle.length ? full : (mmTitle + (full ? ' ' + full : ''))).slice(0, 200);
    items.push({ price: Math.round(price), km: g('mileage') != null ? parseKm(g('mileage')) : null, year: parseYear(g('first-registration')), url: g('guid') ? base.replace(/\/lst.*$/, '') + '/offers/' + g('guid') : null,
      title: title0, img: img, fuel: ({ b: 'petrol', d: 'diesel', e: 'electric', l: 'lpg' })[String(g('fuel-type') || '').toLowerCase()] || normFuel(g('fuel-type')) });
  }
  if (items.length) return items;
  const nd = nextData(html);
  if (nd) walkListings(nd, base, items, 0);
  return items;
}
function parseGenericList(html, base) {
  let items = [];
  const nd = nextData(html);
  if (nd) walkListings(nd, base, items, 0);
  if (!items.length) {
    jsonLd(html).forEach(function (o) {
      if (o.offers || o.price) { const it = itemFromObj(o, base); if (it) items.push(it); }
    });
  }
  if (!items.length) items = parseAs24List(html, base).concat(parseSsList(html, base));
  if (!items.length) {
    // last resort: look around every price in the visible text
    const text = strip(html);
    const re = /(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*€/g;
    let m;
    while ((m = re.exec(text)) && items.length < 80) {
      const price = toNum(m[1]);
      if (!(price >= 500 && price <= 300000)) continue;
      const ctx = text.slice(Math.max(0, m.index - 260), m.index + 60);
      const yr = ctx.match(/\b(20[0-2]\d|199\d)\b/);
      const km = ctx.match(/(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*km/i);
      if (yr) items.push({ price: price, km: km ? toNum(km[1]) : null, year: parseInt(yr[1], 10), url: null, title: '', fuel: null, weak: true });
    }
  }
  return dedupe(items);
}
function dedupe(items) {
  const seen = {};
  return items.filter(function (i) { const id = String(i.url || '').match(/\/([a-z0-9]{4,})\.html?(?:$|[?#])/i) || String(i.url || '').match(/\/offers\/([^/?#]+)/i); const k = id ? 'id:' + id[1].toLowerCase() : (i.url || '') + '|' + i.price + '|' + i.km + '|' + i.year; if (seen[k]) return false; seen[k] = 1; return true; });
}
/* AutoScout24 detail page: everything is in the __NEXT_DATA__ JSON */
function parseAs24Listing(html, url) {
  const nd = nextData(html); const L = nd && pick(nd, ['props', 'pageProps', 'listingDetails']);
  if (!L || !L.vehicle) return null;
  const v = L.vehicle, raw = v.rawData || {};
  const fc = String((v.fuelCategory && v.fuelCategory.raw) || (raw.fuels && raw.fuels.fuelCategory && raw.fuels.fuelCategory.raw) || '').toUpperCase();
  const ff = String((v.fuelCategory && v.fuelCategory.formatted) || '') + ' ' + String((v.primaryFuel && v.primaryFuel.formatted) || '');
  let fuel = { B: 'petrol', D: 'diesel', E: 'electric', L: 'lpg', C: 'petrol', '2': 'hybrid', '3': 'hybrid' }[fc] || null;
  if (/electric\s*\/\s*(gasoline|diesel)|hybrid|elektro\s*\/\s*(benzin|diesel)/i.test(ff)) fuel = 'hybrid';
  if (!fuel) fuel = normFuel(ff);
  const tt = String(v.transmissionType || '').toLowerCase();
  const gearbox = /auto|semi/.test(tt) ? 'automatic' : /manu|schalt/.test(tt) ? 'manual' : normGear(tt);
  const ccm = parseFloat(v.rawDisplacementInCCM || v.rawCylinderCapacity || 0);
  const price = (L.prices && L.prices.public && L.prices.public.priceRaw) || (L.prices && L.prices.dealer && L.prices.dealer.priceRaw) || null;
  const yr = String(v.firstRegistrationDateRaw || (raw.productionDate && raw.productionDate.raw) || '').slice(0, 4);
  const loc = L.location || {};
  const dmg = raw.condition && raw.condition.damage || {};
  const cf = L.vehicleReport && L.vehicleReport.carfax;
  const desc = strip(String(L.description || '').replace(/<\/(li|p|div|br)>/gi, '. ')).slice(0, 8000);
  const listing = {
    make: v.make || null, model: (v.model && v.modelGroup && /er$|series|serie|klasse|class|-reihe/i.test(v.modelGroup) && v.model !== v.modelGroup ? v.model : (v.modelGroup || v.model)) || null, model_raw: [v.model, v.modelVersionInput].filter(Boolean).join(' ') || null,
    year: /^\d{4}$/.test(yr) ? parseInt(yr, 10) : null, mileage_km: v.mileageInKmRaw != null ? Math.round(v.mileageInKmRaw) : null,
    asking_price: price ? Math.round(price) : null, fuel: fuel === 'lpg' ? 'petrol' : fuel, lpg: fuel === 'lpg', gearbox: gearbox,
    engine_l: ccm > 400 ? Math.round(ccm / 100) / 10 : null, power_kw: v.rawPowerInKw || null, drive: driveNorm(v.driveTrain || (raw.driveTrain)), body: v.bodyType || null, color: null,
    vin: null, description: desc,
    posted: L.createdTimestampWithOffset ? String(L.createdTimestampWithOffset).slice(0, 10) : null, updated: null,
    place: [loc.zip, loc.city].filter(Boolean).join(' ') + (loc.countryCode ? ', ' + loc.countryCode : '') || null,
    address: [loc.street, [loc.zip, loc.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
    geo: loc.latitude && loc.longitude ? { lat: Math.round(loc.latitude * 1e5) / 1e5, lon: Math.round(loc.longitude * 1e5) / 1e5 } : null,
    dealer: !!(L.seller && L.seller.isDealer), seller_name: L.seller && (L.seller.companyName || L.seller.contactName) || null,
    accident: v.hadAccident === true || dmg.isCurrentlyDamaged === true ? true : (dmg.accidentFree === true || v.hadAccident === false ? false : null),
    repaired_damage: dmg.hasRepairedDamages === true, owners: v.noOfPreviousOwners || null,
    warranty: L.warrantyExists ? (L.warranty || true) : null,
    report_url: cf && (cf.reportUrlEn || cf.reportUrlDe || cf.reportUrlFr) || null, report_name: cf ? 'Carfax' : null
  };
  listing.src = { make: 'table', model: 'table', year: listing.year ? 'table' : null, mileage_km: listing.mileage_km != null ? 'table' : null, asking_price: listing.asking_price ? 'table' : null,
    fuel: listing.fuel ? 'table' : null, gearbox: listing.gearbox ? 'table' : null, vin: null };
  const nm = cleanMakeModel(listing.make, listing.model); listing.make = nm.make; listing.model = nm.model || listing.model;
  const images = (L.images || []).filter(function (u) { return typeof u === 'string'; }).map(function (u) { return u.replace(/\/\d+x\d+\.webp$/, '/720x540.webp'); }).slice(0, 30);
  return { listing: listing, image: images[0] || null, images: images, title: [v.make, v.model, v.modelVersionInput].filter(Boolean).join(' '), hints: {} };
}
/* autoportaal.ee (Estonia): every listing carries schema.org Product data (make, model, year, km, VIN, price) */
function apProducts(html) {
  const out = [], re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  const walk = function (o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o['@type'] === 'Product' || o['@type'] === 'Car') out.push(o); Object.keys(o).forEach(function (k) { const v = o[k]; if (v && typeof v === 'object' && k !== 'offers' && k !== 'brand') walk(v); }); } };
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1])); } catch (e) { } }
  return out;
}
function driveNorm(x) { const s = String((x && x.formatted) || x || ''); return /all|four|4x4|4wd|awd|allrad/i.test(s) ? 'awd' : /front|vorder/i.test(s) ? 'fwd' : /rear|hinter/i.test(s) ? 'rwd' : null; }
function apFuel(f) { const s = String(f || '').toLowerCase(); return /plug|hybrid|hübriid/.test(s) ? 'hybrid' : /diesel|diisel/.test(s) ? 'diesel' : /electr|elekter/.test(s) ? 'electric' : /lpg|cng|gaas|gas/.test(s) ? 'lpg' : /petrol|bensiin|gasoline/.test(s) ? 'petrol' : null; }
function apItem(o) {
  const off = (Array.isArray(o.offers) ? o.offers[0] : o.offers) || {};
  const price = parseFloat(off.price), eng = o.vehicleEngine || {}, disp = eng.engineDisplacement && parseFloat(eng.engineDisplacement.value), kw = eng.enginePower && parseFloat(eng.enginePower.value);
  const km = o.mileageFromOdometer && o.mileageFromOdometer.value != null ? Math.round(parseFloat(o.mileageFromOdometer.value)) : null;
  const yr = parseInt(o.vehicleModelDate || o.modelDate || String(o.dateVehicleFirstRegistered || '').slice(0, 4), 10) || null;
  const tr = String(o.vehicleTransmission || '').toLowerCase();
  const desc = String(o.description || ''); const tm = desc.match(/auto\s+(.+?),\s*\d{4},/i);
  const img = Array.isArray(o.image) ? o.image[0] : (typeof o.image === 'string' ? o.image : null);
  return { price: price > 0 ? Math.round(price) : null, km: km, year: yr, url: off.url || o.url || null, title: (tm ? tm[1] : o.name || '').slice(0, 120) + (o.vehicleConfiguration ? ' · ' + String(o.vehicleConfiguration).split(',').slice(0, 2).join(',') : ''),
    fuel: apFuel(o.fuelType || eng.fuelType), gear: /auto/.test(tr) ? 'automatic' : /manu/.test(tr) ? 'manual' : null, img: img || null,
    engine_l: disp > 0 && disp < 10 ? disp : null, power_kw: kw || null, vin: o.vehicleIdentificationNumber || null, drive: driveNorm(o.driveWheelConfiguration),
    make: o.brand && o.brand.name || null, model: o.model || null, name: o.name || null };
}
function parseApList(html) {
  const th = {}, re = /id="aimg(\d+)"[^>]*?\ssrc="([^"]+)"/g; let m; while ((m = re.exec(html))) th[m[1]] = m[2];
  return apProducts(html).map(apItem).filter(function (i) { return i.url && i.price >= 300 && i.price <= 500000; }).map(function (i) { const id = (i.url.match(/\/(\d+)$/) || [])[1]; if (id && th[id]) i.img = th[id]; return i; });
}
function parseApListing(html, url) {
  const ps = apProducts(html); if (!ps.length) return null;
  const id = (url.match(/\/(\d+)(?:[?#]|$)/) || [])[1];
  const o = ps.filter(function (x) { const off = (Array.isArray(x.offers) ? x.offers[0] : x.offers) || {}; return id && String(off.url || '').indexOf('/' + id) > -1; })[0] || ps[0];
  const it = apItem(o), t = strip(html);
  const loc = (html.match(/class="location"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
  const sel = (t.match(/Müüja:\s*(.+?)\s+(?:[A-ZÕÄÖÜ][a-zõäöü]+,\s*Eesti|Telefon)/) || [])[1];
  const li = t.indexOf('Lisainfo'); const extra = li > -1 ? t.slice(li + 8, li + 1500).replace(/\s+(Mootorsõidukimaks|Registreerimistasu|Aastamaks)[\s\S]*$/, '') : '';
  const listing = { make: it.make, model: it.model, model_raw: (String(o.description || '').match(/auto\s+(.+?),\s*\d{4},/i) || [])[1] || it.name, year: it.year, mileage_km: it.km, asking_price: it.price,
    fuel: it.fuel === 'lpg' ? 'petrol' : it.fuel, lpg: it.fuel === 'lpg', gearbox: it.gear, engine_l: it.engine_l, power_kw: it.power_kw, drive: it.drive, body: o.bodyType || null, color: o.color || null,
    vin: it.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(it.vin) ? it.vin : null, description: (String(o.description || '') + '. ' + extra).slice(0, 8000), posted: null, updated: null,
    place: loc ? strip(loc) : null, address: null, geo: null, dealer: /\b(OÜ|AS|SIA|UAB)\b/.test(sel || ''), seller_name: sel || null, accident: null, repaired_damage: false, owners: null, warranty: null };
  listing.src = { make: 'table', model: 'table', year: listing.year ? 'table' : null, mileage_km: listing.mileage_km != null ? 'table' : null, asking_price: listing.asking_price ? 'table' : null, fuel: listing.fuel ? 'table' : null, gearbox: listing.gearbox ? 'table' : null, vin: listing.vin ? 'table' : null };
  const nm = cleanMakeModel(listing.make, listing.model); listing.make = nm.make; listing.model = nm.model || listing.model;
  const images = (Array.isArray(o.image) ? o.image : []).filter(function (u) { return typeof u === 'string'; }).slice(0, 30);
  return { listing: listing, image: images[0] || null, images: images, title: listing.model_raw || it.name, hints: {} };
}
function parseGenericListing(html, url) {
  const L = { make: null, model: null, year: null, mileage_km: null, asking_price: null, fuel: null, gearbox: null, color: null, body: null, vin: null, description: '' };
  let image = meta(html, 'og:image');
  const nd = nextData(html);
  const ld = jsonLd(html).filter(function (o) { return /Car|Vehicle|Product/i.test(String(o['@type'])); })[0];
  if (ld) {
    const it = itemFromObj(ld, url);
    if (it) { L.asking_price = it.price; L.mileage_km = it.km; L.year = it.year; }
    L.vin = ld.vehicleIdentificationNumber ? vinIn(ld.vehicleIdentificationNumber) : null;
    L.fuel = normFuel(ld.fuelType || ''); L.gearbox = normGear(ld.vehicleTransmission || ''); L.color = ld.color || null; L.body = ld.bodyType || null;
    const gm = guessMakeModel((ld.brand && (ld.brand.name || ld.brand)) ? (ld.brand.name || ld.brand) + ' ' + (ld.model || ld.name || '') : (ld.name || ''));
    L.make = gm.make; L.model = ld.model && typeof ld.model === 'string' ? ld.model : gm.model;
    if (!image && ld.image) image = Array.isArray(ld.image) ? ld.image[0] : (ld.image.url || ld.image);
  }
  if (nd) {
    const found = [];
    walkListings(nd, url, found, 0);
  }
  const title = meta(html, 'og:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [0, ''])[1];
  const text = strip(html).slice(0, 60000);
  const tx = parseText(text.slice(0, 12000));
  if (!L.make) { const gm = guessMakeModel(strip(title)); L.make = gm.make; L.model = gm.model; }
  if (L.asking_price == null) { const pm = parseText(strip(title) + ' ' + (meta(html, 'og:description') || '')); L.asking_price = pm.price || tx.price || null; }
  if (L.mileage_km == null) L.mileage_km = tx.km != null ? tx.km : null;
  if (L.year == null) L.year = tx.year || null;
  if (!L.vin) L.vin = tx.vin || null;
  if (!L.fuel) L.fuel = fuelEarliest(strip(title) + ' ' + (meta(html, 'og:description') || '')) || tx.fuel || null;
  if (!L.gearbox) L.gearbox = tx.gearbox || null;
  L.description = (meta(html, 'og:description') || '').slice(0, 600);
  return { listing: L, image: image ? absUrl(image, url) : null, title: strip(title || '') };
}


/* ---------------- photos ---------------- */
const IMG_HOSTS = [
  /(^|\.)copart\.com$/, /(^|\.)iaai\.com$/, /(^|\.)vincheck\.it\.com$/,
  /(^|\.)ss\.(com|lv)$/, /(^|\.)autoscout24\.(net|com|de)$/, /(^|\.)autoplius\.lt$/, /(^|\.)dgn\.lt$/, /(^|\.)auto24\.(ee|lv|lt)$/,
  /(^|\.)olxcdn\.com$/, /(^|\.)classistatic\.de$/, /(^|\.)autoportaal\.ee$/, /(^|\.)autovit\.ro$/
];
function imgAllowed(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && IMG_HOSTS.some(function (re) { return re.test(x.hostname); }); } catch (e) { return false; }
}
function collectImages(html, base) {
  const out = [], seen = {};
  function add(u) {
    if (!u) return;
    u = absUrl(String(u).replace(/&amp;/g, '&'), base);
    if (!u || !imgAllowed(u)) return;
    if (/(logo|icon|sprite|banner|avatar|flag|noimage|placeholder)/i.test(u) || /\/img\/m\//i.test(u) || /-\d{2,3}x\d{2,3}\.png$/i.test(u)) return;
    // ss.com: thumbnails (.t.jpg, .th2.jpg, .th.jpg) -> large (.800.jpg)
    const big = u.replace(/\.(?:th2|th|t|\d{2,3})\.(jpe?g|png)(\?.*)?$/i, '.800.$1');
    const key = big.replace(/\.\d{2,4}\.(jpe?g|png)$/i, '');
    if (seen[key]) return; seen[key] = 1; out.push(big);
  }
  let m; const re = /(?:src|data-src|data-original|href|content)=["']([^"']+\.(?:jpe?g|png)(?:\?[^"']*)?)["']/gi;
  while ((m = re.exec(html)) && out.length < 40) add(m[1]);
  const re2 = /https?:\/\/i\.ss\.(?:com|lv)\/gallery\/[^"'\s<>)\\]+?\.(?:jpe?g|png)/gi;
  while ((m = re2.exec(html)) && out.length < 40) add(m[0]);
  const og = meta(html, 'og:image'); if (og) add(og);
  return out.slice(0, 20);
}
async function hImg(env, q) {
  const url = q.get('url');
  if (!url || !imgAllowed(url)) return json(env, { ok: false, error: 'bad_url' }, 400);
  const r = await fetch(url, { headers: { 'user-agent': UA, 'referer': new URL(url).origin + '/', 'accept': 'image/avif,image/webp,image/*,*/*;q=0.8' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  const ct = r.headers.get('content-type') || '';
  const len = parseInt(r.headers.get('content-length') || '0', 10);
  if (!r.ok || !/^image\//i.test(ct)) return json(env, { ok: false, error: 'not_image', status: r.status }, 502);
  if (len > 6000000) return json(env, { ok: false, error: 'too_large' }, 413);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 6000000) return json(env, { ok: false, error: 'too_large' }, 413);
  return new Response(buf, { status: 200, headers: Object.assign({ 'content-type': ct, 'cache-control': 'public, max-age=86400' }, cors(env)) });
}

/* ---------------- handlers ---------------- */
async function hListing(env, q, ctx) {
  const url = q.get('url');
  if (!url || !allowed(url)) return json(env, { ok: false, error: 'bad_url', message: 'Link missing or site not supported.' }, 400);
  const host = new URL(url).hostname;
  const p = await getPage(url, 600);
  const b = blockedBy(p);
  if (b) return json(env, { ok: false, error: 'blocked', message: 'The site refused the server request (' + b + ').', diag: { status: p.status, bytes: p.text.length } });
  if (p.status === 404) { later(ctx, memGone(env, url)); return json(env, { ok: false, error: 'not_found', message: 'Listing page not found (removed or wrong link).' }); }
  let res, parser;
  if (/(^|\.)ss\.(com|lv)$/.test(host) && /\/msg\//.test(url)) {
    res = parseSsListing(p.text, p.url); parser = 'ss';
    const g = parseGenericListing(p.text, p.url);
    res.image = g.image; res.title = g.title;
    Object.keys(g.listing).forEach(function (k) { if (k === 'fuel') return; if (res.listing[k] == null || res.listing[k] === '') res.listing[k] = g.listing[k]; });
  } else if (/(^|\.)autoscout24\.[a-z.]+$/.test(host) && (res = parseAs24Listing(p.text, p.url))) { parser = 'as24';
  } else if (/(^|\.)autoportaal\.ee$/.test(host) && (res = parseApListing(p.text, p.url))) { parser = 'autoportaal';
  } else { res = parseGenericListing(p.text, p.url); parser = 'generic'; res.hints = {}; }
  const L = res.listing;
  if (parser === 'ss' && L.removed) { later(ctx, memGone(env, url)); } 
  if (parser === 'ss' && L.removed) return json(env, { ok: false, error: 'not_found', removed: true, message: 'The listing was removed or has expired.', source: host, parser: parser, listing: L });
  const filled = ['make', 'model', 'year', 'mileage_km', 'asking_price'].filter(function (k) { return L[k] != null; }).length;
  if (filled >= 3 && L.asking_price > 0 && adKey(url)) later(ctx, memSave(env, [{ id: adKey(url), src: parser, mk: memNorm(L.make), md: memNorm(L.model), yr: L.year || null, vin: L.vin || null, title: String(res.title || '').slice(0, 90), p: Math.round(L.asking_price), km: L.mileage_km != null ? Math.round(L.mileage_km) : null, posted: L.posted || null }]));
  return json(env, { ok: filled >= 2, error: filled >= 2 ? null : 'parse_failed', message: filled >= 2 ? null : 'Could not read the main fields from this page.', source: host, parser: parser,
    listing: L, image: res.image || null, images: res.images || collectImages(p.text, p.url), title: res.title || null, hints: res.hints || {}, diag: { status: p.status, bytes: p.text.length, filled: filled } });
}

function filterOthers(items, make, model) {
  const w = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); };
  const has = function (t, s) { return !!s && (' ' + w(t) + ' ').indexOf(' ' + s + ' ') > -1; };
  const mk = w(make), md = w(model);
  const byModel = items.filter(function (i) { return md && has(i.title, md); });
  if (byModel.length >= 3) return byModel;
  return items.filter(function (i) { return (md && has(i.title, md)) || has(i.title, mk) || (mk === 'gwm' && (has(i.title, 'great wall') || has(i.title, 'ora'))); });
}
const SS_GEN = {
  golf: { 'golf-4': [1997, 2004], 'golf-5': [2003, 2009], 'golf-6': [2008, 2013], 'golf-7': [2012, 2020], 'golf-8': [2019, 2030], 'golf-variant': [1993, 2030] },
  passat: { 'passat-b5': [1996, 2005], 'passat-b6': [2005, 2011], 'passat-b7': [2010, 2015], 'passat-b8': [2014, 2030], 'passat-variant': [1988, 2030] }
};
async function hComps(env, q, ctx) {
  const source = q.get('source');
  const cm = cleanMakeModel(q.get('make') || '', q.get('model') || '');
  const make = cm.make || '', model = cm.model || '';
  const year = parseInt(q.get('year') || '', 10) || null;
  const yf = parseInt(q.get('yfrom') || '', 10) || (year ? year - 1 : null), yt = parseInt(q.get('yto') || '', 10) || (year ? year + 1 : null);
  if (source === 'ss') {
    let path = q.get('ssPath');
    let others = !!path && /^\/[a-z]{2}\/transport\/cars\/others\/$/i.test(path);
    if (!others && (!path || !/^\/[a-z]{2}\/transport\/cars\/[a-z0-9\-]+\/[a-z0-9\-]+\/$/i.test(path))) {
      let mk = slugify(make); if (mk === 'mercedes-benz') mk = 'mercedes'; if (mk === 'vw') mk = 'volkswagen'; if (mk === 'land-rover') mk = 'rover';
      let md = slugify(model);
      if (/^bmw$/.test(mk) && /^\d{3}[a-z]*$/.test(md)) md = md.slice(0, 3);
      if (mk === 'toyota' && md === 'rav4') md = 'rav-4';
      if (mk === 'mercedes') { const mm2 = md.match(/^([a-z]{1,4})-?(\d{2,3})(?!\d)/); if (mm2) md = mm2[1] + mm2[2]; }
      if (!mk || !md) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
      path = '/ru/transport/cars/' + mk + '/' + md + '/';
    }
    let base = 'https://www.ss.com' + path;
    const fetchSs0 = function (b, n) { const us = [b]; for (let k = 2; k <= n; k++) us.push(b + 'page' + k + '.html'); return Promise.all(us.map(function (u) { return getPage(u, 900).catch(function (e) { return { status: 0, text: '', url: u, err: String(e) }; }); })); };
    const fetchSs = fetchSs0;
    let pages = await fetchSs(base, others ? 8 : 5);
    /* ss.lv splits some models into generations (golf-7, passat-b8 ...): pick the ones for this year */
    if (!others && (pages[0].status === 404 || !/id="tr_\d/.test(pages[0].text))) {
      const mkPath = path.replace(/[^/]+\/$/, ''), mdSlug = path.split('/').filter(Boolean).pop();
      const mp = await getPage('https://www.ss.com' + mkPath, 3600).catch(function () { return { status: 0, text: '' }; });
      const subs = []; const re = new RegExp('href="' + mkPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(' + mdSlug.replace(/[^a-z0-9\-]/g, '') + '-[a-z0-9\-]+)/"', 'g'); let mm;
      while ((mm = re.exec(mp.text))) if (subs.indexOf(mm[1]) < 0) subs.push(mm[1]);
      const G = SS_GEN[mdSlug] || {};
      let pick = subs.filter(function (x) { const g = G[x]; return g ? (!year || (year >= g[0] - 1 && year <= g[1] + 1)) : !/plus|sportsvan|van$|alltrack|cc$/.test(x) && !Object.keys(G).length; });
      if (!pick.length) pick = subs.filter(function (x) { return !G[x] && !/plus|sportsvan/.test(x); }).slice(0, 3);
      pick = pick.slice(0, 3);
      if (pick.length) {
        const sets = await Promise.all(pick.map(function (x) { return fetchSs('https://www.ss.com' + mkPath + x + '/', 3); }));
        pages = [].concat.apply([], sets); base = 'https://www.ss.com' + mkPath + pick[0] + '/';
      }
    }
    /* A make that ss.com does not have as its own category (for example GWM or other Chinese brands) is listed under "Others". */
    if (!others && pages[0].status === 404) {
      others = true; base = 'https://www.ss.com/ru/transport/cars/others/'; pages = await fetchSs(base, 8);
    }
    const first = pages[0];
    const b = blockedBy(first);
    if (b) return json(env, { ok: false, source: 'ss', error: 'blocked', message: 'ss.com refused the server request (' + b + ').', searchUrl: base });
    if (first.status === 404 || !/id="tr_/.test(first.text)) return json(env, { ok: false, source: 'ss', error: first.status === 404 ? 'not_found' : 'parse_failed', message: first.status === 404 ? 'Category not found for this make/model.' : 'No ads found on the page.', searchUrl: base, diag: { status: first.status } });
    let items = [];
    pages.forEach(function (p) { if (p.status === 200) items = items.concat(parseSsList(p.text, p.url)); });
    items = dedupe(items);
    if (others) items = filterOthers(items, make, model);
    later(ctx, memSave(env, memRowsFromItems(items, make, model, 'ss')));
    return json(env, { ok: items.length > 0, source: 'ss', region: 'LV', label: 'ss.com', searchUrl: base, items: items, pages: pages.filter(function (p) { return p.status === 200; }).length, error: items.length ? null : 'parse_failed', message: items.length ? null : 'Page loaded but no ads were recognised.' });
  }
  if (source === 'as24de' || source === 'as24') {
    const CY = { D: 'DE', B: 'BE', NL: 'NL', F: 'FR', A: 'AT', I: 'IT', L: 'LU' };
    const cy = source === 'as24de' ? 'D' : String(q.get('cy') || 'D').toUpperCase();
    if (!CY[cy]) return json(env, { ok: false, error: 'bad_source', message: 'Unknown country.' }, 400);
    const srcName = 'as24' + CY[cy].toLowerCase();
    let mk = slugify(make); if (mk === 'mercedes') mk = 'mercedes-benz'; if (mk === 'vw') mk = 'volkswagen';
    let md = as24Model(mk, slugify(model));
    if (mk === 'gwm' && /^ora/.test(md)) { mk = 'ora'; md = ''; }
    if (!mk || (!md && mk !== 'ora')) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
    const fuelCode = { diesel: 'D', petrol: 'B', electric: 'E', lpg: 'L' }[q.get('fuel')] || '';
    const f = (fuelCode ? '&fuel=' + fuelCode : '') + (yf ? '&fregfrom=' + yf : '') + (yt ? '&fregto=' + yt : '');
    const trim = String(q.get('trim') || '').replace(/[^A-Za-z0-9 \-+&]/g, '').trim().slice(0, 30);
    const mkUrlV = function (p, tv) { return 'https://www.autoscout24.com/lst/' + mk + (md ? '/' + md : '') + '?atype=C&cy=' + cy + '&damaged_listing=exclude&desc=0' + f + (tv ? '&version=' + encodeURIComponent(tv) : '') + '&sort=standard&ustate=N%2CU&page=' + p; };
    const fetchSet = function (tv) { return Promise.all([1, 2, 3].map(function (n) { return getPage(mkUrlV(n, tv), 900).catch(function (e) { return { status: 0, text: '', url: mkUrlV(n, tv) }; }); })); };
    let usedTrim = '';
    let pages = await fetchSet(trim);
    if (trim && pages[0].status === 200 && !blockedBy(pages[0]) && parseAs24List(pages[0].text, 'https://www.autoscout24.com/lst/').length >= 3) usedTrim = trim;
    else if (trim) pages = await fetchSet('');
    const mkUrl = function (p) { return mkUrlV(p, usedTrim); };
    const b = blockedBy(pages[0]);
    const search = mkUrl(1);
    if (b) return json(env, { ok: false, source: srcName, error: 'blocked', message: 'AutoScout24 refused the server request (' + b + ').', searchUrl: search });
    if (pages[0].status === 404) return json(env, { ok: false, source: srcName, error: 'not_found', message: 'Make/model not found on AutoScout24.', searchUrl: search });
    let items = [];
    pages.forEach(function (p) { if (p.status === 200) items = items.concat(parseAs24List(p.text, 'https://www.autoscout24.com/lst/')); });
    items = dedupe(items);
    if (/\/lst\//.test(pages[0].url || '') === false || (pages[0].url || '').toLowerCase().indexOf('/lst/' + mk) === -1) return json(env, { ok: false, source: srcName, error: 'not_found', message: 'AutoScout24 redirected away from this make/model.', searchUrl: search });
    if (year && items.length >= 10) {
      const inY = items.filter(function (i) { return i.year == null || (i.year >= (yf || year - 1) && i.year <= (yt || year + 1)); }).length;
      if (inY / items.length < 0.5) return json(env, { ok: false, source: srcName, error: 'filters_ignored', message: 'AutoScout24 did not apply the model/year filters.', searchUrl: search });
    }
    if (usedTrim) items.forEach(function (i) { i.trimMatch = usedTrim; });
    later(ctx, memSave(env, memRowsFromItems(items, make, model, 'as24')));
    return json(env, { ok: items.length > 0, source: srcName, region: CY[cy], label: 'AutoScout24 (' + CY[cy] + ')', searchUrl: search, trimFilter: usedTrim || null, items: items, error: items.length ? null : 'parse_failed', message: items.length ? null : 'Page loaded but no ads were recognised.' });
  }
  if (source === 'autoplius') {
    let mk = slugify(make); if (mk === 'vw') mk = 'volkswagen'; if (mk === 'mercedes') mk = 'mercedes-benz';
    const md = slugify(model);
    if (!mk || !md) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
    const yq = (yf ? '&make_date_from=' + yf : '') + (yt ? '&make_date_to=' + yt : '');
    const mkUrl = function (p) { return 'https://en.autoplius.lt/ads/used-cars/' + mk + '/' + md + '?' + yq.slice(1) + (p > 1 ? '&page_nr=' + p : ''); };
    let pages = await Promise.all([1, 2].map(function (n) { return getPage(mkUrl(n), 3600).catch(function (e) { return { status: 0, text: '', url: mkUrl(n) }; }); }));
    if (blockedBy(pages[0])) { await new Promise(function (r) { setTimeout(r, 1200); }); pages = [await getPage(mkUrl(1), 3600).catch(function () { return { status: 0, text: '', url: mkUrl(1) }; })]; }
    const search = mkUrl(1), b = blockedBy(pages[0]);
    if (b) return json(env, { ok: false, source: 'autoplius', error: 'blocked', message: 'autoplius.lt refused the server request (' + b + ').', searchUrl: search });
    if (pages[0].status === 404 || (pages[0].url || '').toLowerCase().indexOf('/' + mk + '/' + md) === -1) return json(env, { ok: false, source: 'autoplius', error: 'not_found', message: 'Make/model not found on autoplius.lt.', searchUrl: search });
    let items = [];
    pages.forEach(function (p) { if (p.status === 200) items = items.concat(parseAutopliusList(p.text, p.url)); });
    items = dedupe(items);
    later(ctx, memSave(env, memRowsFromItems(items, make, model, 'autoplius')));
    return json(env, { ok: items.length > 0, source: 'autoplius', region: 'LT', label: 'autoplius.lt', searchUrl: search, items: items, error: items.length ? null : 'parse_failed', message: items.length ? null : 'No ads found on the page.' });
  }
  if (source === 'autoportaal') {
    if (!make || !model) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
    const apMk = /^mercedes/i.test(make) ? 'Mercedes-Benz' : /^vw$/i.test(make) ? 'Volkswagen' : make;
    const mkUrl = function (p) { return 'https://autoportaal.ee/et/kasutatud-autod?make=' + encodeURIComponent(apMk) + '&model=' + encodeURIComponent(model) + (yf ? '&year_min=' + yf : '') + (yt ? '&year_max=' + yt : '') + (p > 1 ? '&page=' + p : ''); };
    const pages = await Promise.all([1, 2, 3, 4].map(function (n) { return getPage(mkUrl(n), 1800).catch(function () { return { status: 0, text: '', url: mkUrl(n) }; }); }));
    const search = mkUrl(1), b = blockedBy(pages[0]);
    if (b) return json(env, { ok: false, source: 'autoportaal', error: 'blocked', message: 'autoportaal.ee refused the server request (' + b + ').', searchUrl: search });
    let items = [];
    pages.forEach(function (p) { if (p.status === 200) items = items.concat(parseApList(p.text)); });
    items = dedupe(items);
    const w = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
    const mw = w(model), mkw = w(apMk);
    items = items.filter(function (i) { return (!i.make || w(i.make) === mkw || w(i.make).indexOf(mkw) === 0 || mkw.indexOf(w(i.make)) === 0) && (!i.model || w(i.model) === mw || w(i.model).indexOf(mw) === 0); });
    if (year && items.length >= 10) {
      const inY = items.filter(function (i) { return i.year == null || (i.year >= (yf || year - 1) && i.year <= (yt || year + 1)); }).length;
      if (inY / items.length < 0.5) return json(env, { ok: false, source: 'autoportaal', error: 'filters_ignored', message: 'autoportaal.ee did not apply the model/year filters.', searchUrl: search });
    }
    items.forEach(function (i) { delete i.make; delete i.model; delete i.name; });
    later(ctx, memSave(env, memRowsFromItems(items, make, model, 'autoportaal')));
    return json(env, { ok: items.length > 0, source: 'autoportaal', region: 'EE', label: 'autoportaal.ee', searchUrl: search, items: items, error: items.length ? null : 'parse_failed', message: items.length ? null : 'No ads found for this make/model.' });
  }
  return json(env, { ok: false, error: 'bad_source', message: 'Unknown source.' }, 400);
}

/* ss.lv seller: number of views and every other ad with the same phone number.
   ss.lv puts these into a small script that loads with the page; it needs the page's cookies and browser-like headers. */
function cookieJar(jar, r) {
  const all = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? r.headers.get('set-cookie').split(/,(?=\s*[A-Za-z_]+=)/) : []);
  all.forEach(function (c) { const kv = String(c).split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); });
  return jar;
}
function jarStr(jar) { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); }
async function hSeller(env, q, ctx) {
  const url = q.get('url');
  if (!url || !allowed(url) || !/(^|\.)ss\.(com|lv)$/.test(new URL(url).hostname) || !/\/msg\//.test(url)) return json(env, { ok: false, error: 'bad_url', message: 'Only ss.lv / ss.com listing links are supported.' }, 400);
  const origin = new URL(url).origin, jar = {};
  const H = { 'user-agent': UA, 'accept-language': 'lv,en;q=0.9,ru;q=0.8' };
  const r1 = await fetch(url, { headers: Object.assign({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, H), redirect: 'follow' });
  cookieJar(jar, r1); const html = await r1.text();
  const dt = ssDates(html);
  const sm = html.match(/id="contacts_js"\s+src="([^"]+)"/);
  if (!sm) return json(env, { ok: false, error: 'no_contacts', message: 'The seller block was not found on the page.', posted: dt.posted, updated: dt.updated });
  const js = origin + dec(sm[1]);
  let txt = '';
  for (let k = 0; k < 3 && !/ADS_STAT/.test(txt); k++) {
    const r2 = await fetch(js, { headers: Object.assign({ accept: '*/*', referer: url, cookie: jarStr(jar), 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin' }, H) });
    cookieJar(jar, r2); txt = await r2.text();
  }
  const st = txt.match(/ADS_STAT=\[([-\d,\s]+)\]/), lk = txt.match(/OPEN_STAT_LNK="([^"]+)"/);
  if (!st) return json(env, { ok: false, error: 'no_stats', message: 'ss.lv did not return the seller data.', posted: dt.posted, updated: dt.updated });
  const a = st[1].split(',').map(function (x) { return parseInt(x, 10); });
  const out = { ok: true, posted: dt.posted, updated: dt.updated, views: a[4] > 0 ? a[4] : null, phoneLinked: a[0] >= 0, emailLinked: a[3] >= 0, items: [], searchUrl: null };
  if (lk) later(ctx, memSeller(env, url, lk[1]));
  if (lk && a[0] >= 0) {
    const lang = (url.match(/\/msg\/([a-z]{2})\//) || [])[1] || 'lv';
    const su = origin + '/' + lang + '/search-result/?t=' + encodeURIComponent(lk[1]);
    out.searchUrl = su;
    const r3 = await fetch(su, { headers: Object.assign({ accept: 'text/html,*/*;q=0.8', referer: url, cookie: jarStr(jar) }, H) });
    const sh = await r3.text();
    const links = {}; (sh.match(/href="\/msg\/[a-z]{2}\/[^"]+\.html"/g) || []).forEach(function (h) { links[h.slice(6, -1)] = 1; });
    out.adsTotal = Object.keys(links).length;
    out.carAds = Object.keys(links).filter(function (h) { return /\/transport\/cars\//.test(h); }).length;
    out.cats = {}; Object.keys(links).forEach(function (h) { const c = (h.match(/^\/msg\/[a-z]{2}\/([^/]+\/[^/]+)\//) || [])[1] || 'other'; out.cats[c] = (out.cats[c] || 0) + 1; });
    out.items = parseSsList(sh, su).filter(function (i) { return /\/transport\/cars\//.test(i.url || ''); }).map(function (i) { const m = (i.url || '').match(/\/cars\/([^/]+)\/([^/]+)\//); i.mk = m ? m[1] : null; i.md = m ? m[2] : null; return i; }).slice(0, 120);
  }
  return json(env, out);
}

/* Salvage / insurance auction history by VIN (Copart, IAAI) from the public pages of vincheck.it.com */
function vcText(h) { return strip(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')).replace(/\s+/g, ' '); }
function parseVcLot(html, url) {
  const t = vcText(html);
  const g = function (re) { const m = t.match(re); return m ? m[1].trim() : null; };
  const odo = g(/Odometer\s+([\d,]+)\s*mi/i), price = g(/Price\s+Sold for \$([\d,]+)/i) || g(/sold for \$([\d,]+)/i);
  const photos = []; const re = /img\/auction\?u=([^"'&\s]+)/g; let m;
  while ((m = re.exec(html)) && photos.length < 24) { try { const u = decodeURIComponent(m[1]); if (/^https:\/\//.test(u) && photos.indexOf(u) < 0) photos.push(u); } catch (e) { } }
  return { url: url, lot: g(/Lot #\s*(\d+)/i), source: g(/Source\s+([A-Z]{3,10})/), date: g(/Sale date\s+(\d{4}-\d{2}-\d{2})/i), damage: g(/Primary damage\s+([A-Z][A-Z &\/\-]+?)\s+(?:Secondary|Title|Has keys)/), damage2: g(/Secondary damage\s+([A-Z][A-Z &\/\-]+?)\s+(?:Title|Has keys)/),
    title: g(/Title document\s+(.+?)\s+Has keys/i), keys: g(/Has keys\s+(Yes|No)/i), location: g(/Location\s+(.+?)\s+Sale date/i), odometer_mi: odo ? parseInt(odo.replace(/,/g, ''), 10) : null,
    price_usd: price ? parseInt(price.replace(/,/g, ''), 10) : null, retail_usd: (function () { const r = g(/estimated retail \(undamaged\) value is \$([\d,]+)/i); return r ? parseInt(r.replace(/,/g, ''), 10) : null; })(), photos: photos };
}
async function hVinHistory(env, q) {
  const vin = String(q.get('vin') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json(env, { ok: false, error: 'bad_vin' }, 400);
  const base = 'https://vincheck.it.com';
  const p = await getPage(base + '/vin/' + vin, 86400).catch(function () { return { status: 0, text: '' }; });
  if (p.status === 404 || (p.status === 200 && p.text.indexOf(vin) < 0)) return json(env, { ok: true, vin: vin, found: false, source: 'vincheck.it.com' });
  if (p.status !== 200) return json(env, { ok: false, vin: vin, error: blockedBy(p) ? 'blocked' : 'unavailable', status: p.status });
  const t = vcText(p.text);
  const n = parseInt((t.match(/Auction records\s+(\d+)/i) || t.match(/with (\d+) auction record/i) || [])[1] || '0', 10);
  const lotLinks = []; const re = /href="(\/auctions\/lot\/\d+[^"]*)"/g; let m;
  while ((m = re.exec(p.text))) if (lotLinks.indexOf(m[1]) < 0) lotLinks.push(m[1]);
  if (!n && !lotLinks.length) return json(env, { ok: true, vin: vin, found: false, source: 'vincheck.it.com' });
  const lots = [];
  for (const l of lotLinks.slice(0, 3)) {
    const lp = await getPage(base + l, 86400).catch(function () { return { status: 0, text: '' }; });
    if (lp.status === 200) lots.push(parseVcLot(lp.text, base + l));
  }
  const summary = { title: (t.match(/decodes to an? (\d{4} [^,(]+)/) || [])[1] || null, damage: (t.match(/primary damage ([A-Z][A-Z &\/\-]+?),/) || [])[1] || null };
  return json(env, { ok: true, vin: vin, found: true, records: n || lots.length, summary: summary, lots: lots, page: base + '/vin/' + vin, source: 'vincheck.it.com' });
}

async function hSearch(env, q) {
  const url = q.get('url');
  if (!url || !allowed(url)) return json(env, { ok: false, error: 'bad_url', message: 'Link missing or site not supported.' }, 400);
  const p = await getPage(url, 900);
  const b = blockedBy(p);
  const host = new URL(url).hostname;
  if (b) return json(env, { ok: false, error: 'blocked', message: 'The site refused the server request (' + b + ').', source: host, searchUrl: url });
  let items;
  if (/(^|\.)ss\.(com|lv)$/.test(host)) items = parseSsList(p.text, p.url);
  else items = parseGenericList(p.text, p.url);
  const weak = items.length && items.every(function (i) { return i.weak; });
  return json(env, { ok: items.length > 0, source: host, label: host, searchUrl: url, items: items.slice(0, 200), weak: !!weak, error: items.length ? null : 'parse_failed', message: items.length ? (weak ? 'Rough reading: check the numbers.' : null) : 'No ads recognised on this page.' });
}

async function hDebug(env, q) {
  const url = q.get('url');
  if (!url || !allowed(url)) return json(env, { ok: false, error: 'bad_url' }, 400);
  const p = await getPage(url, 60);
  return json(env, {
    ok: true, status: p.status, finalUrl: p.url, bytes: p.text.length, blocked: blockedBy(p),
    hasNextData: !!nextData(p.text), jsonLdTypes: jsonLd(p.text).map(function (o) { return o['@type']; }).filter(Boolean).slice(0, 10),
    ssRows: (p.text.match(/<tr[^>]+id="tr_\d+"/gi) || []).length, as24Articles: (p.text.match(/<article\b[^>]*data-guid/gi) || []).length,
    parsedItems: parseGenericList(p.text, p.url).length, sample: parseGenericList(p.text, p.url).slice(0, 4),
    firstArticle: ((p.text.match(/<article\b[^>]*>/i) || [''])[0]).slice(0, 700),
    mileageSnippets: (p.text.match(/.{0,60}mileage.{0,90}/gi) || []).slice(0, 6),
    textStart: strip(p.text).slice(0, 500),
    around: (function () { const f = q.get('find'); if (!f) return null; const i = p.text.indexOf(f); if (i < 0) return 'not found'; const n = Math.min(parseInt(q.get('len') || '4000', 10) || 4000, 12000); return p.text.slice(Math.max(0, i - n / 2), i + n / 2); })()
  });
}

/* ================= CarScout memory (Cloudflare D1, optional binding DB) =================
   Remembers listings it has seen: price and mileage over time, VIN, a hash of the ss.lv seller link, and when an ad disappeared.
   Public listing data only; the seller link is stored as a one-way hash. */
let MEM_READY = false;
async function memInit(env) {
  if (!env || !env.DB) return false; if (MEM_READY) return true;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ads(id TEXT PRIMARY KEY, src TEXT, mk TEXT, md TEXT, yr INT, vin TEXT, seller TEXT, title TEXT, ft INT, fp INT, fkm INT, lt INT, lp INT, lkm INT, n INT DEFAULT 1, gone INT, posted TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS ads_vin ON ads(vin)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS ads_seller ON ads(seller)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS ads_mm ON ads(mk, md, yr)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS hist(id TEXT, t INT, p INT, km INT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS hist_id ON hist(id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS watch(code TEXT PRIMARY KEY, data TEXT, t INT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)')
  ]);
  try { await env.DB.prepare('ALTER TABLE watch ADD COLUMN chat INTEGER').run(); } catch (e) { }
  try { await env.DB.prepare('ALTER TABLE watch ADD COLUMN lang TEXT').run(); } catch (e) { }
  MEM_READY = true; return true;
}
function adKey(url) {
  const u = String(url || '');
  let m = u.match(/ss\.(?:com|lv)\/msg\/(?:[a-z]{2}\/)?[^?#]*?\/([a-z0-9]{4,})\.html/i); if (m) return 'ss:' + m[1].toLowerCase();
  m = u.match(/autoplius\.lt\/[^?#]*?-(\d{5,})\.html/i); if (m) return 'ap:' + m[1];
  m = u.match(/autoscout24\.[a-z.]+\/(?:offers|angebote|annonces|aanbod|ofertas)\/[^?#]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i); if (m) return 'as:' + m[1].toLowerCase();
  m = u.match(/autoportaal\.ee\/[a-z]{2}\/kasutatud-autod\/(\d+)/i); if (m) return 'ee:' + m[1];
  return null;
}
function memNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/mercedes-benz/, 'mercedes').replace(/[^a-z0-9]+/g, ''); }
function later(ctx, p) { const q = Promise.resolve(p).catch(function () { }); if (ctx && ctx.waitUntil) ctx.waitUntil(q); return q; }
async function memSave(env, rows) {
  if (!rows.length || !(await memInit(env))) return;
  const now = Date.now(), js = JSON.stringify(rows.slice(0, 300));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO hist(id, t, p, km) SELECT j.value->>'id', ?2, j.value->>'p', j.value->>'km' FROM json_each(?1) j LEFT JOIN ads a ON a.id = j.value->>'id' WHERE a.id IS NULL OR a.lp IS NOT (j.value->>'p') OR (j.value->>'km' IS NOT NULL AND a.lkm IS NOT (j.value->>'km'))").bind(js, now),
    env.DB.prepare("INSERT INTO ads(id, src, mk, md, yr, vin, title, ft, fp, fkm, lt, lp, lkm, n, posted) SELECT j.value->>'id', j.value->>'src', j.value->>'mk', j.value->>'md', j.value->>'yr', j.value->>'vin', j.value->>'title', ?2, j.value->>'p', j.value->>'km', ?2, j.value->>'p', j.value->>'km', 1, j.value->>'posted' FROM json_each(?1) j WHERE true " +
      "ON CONFLICT(id) DO UPDATE SET lt = excluded.lt, lp = excluded.lp, lkm = COALESCE(excluded.lkm, ads.lkm), n = ads.n + 1, gone = NULL, vin = COALESCE(ads.vin, excluded.vin), posted = COALESCE(ads.posted, excluded.posted), yr = COALESCE(ads.yr, excluded.yr) " +
      "WHERE excluded.lp IS NOT ads.lp OR (excluded.lkm IS NOT NULL AND excluded.lkm IS NOT ads.lkm) OR excluded.lt - ads.lt > 259200000 OR ads.gone IS NOT NULL OR (ads.vin IS NULL AND excluded.vin IS NOT NULL) OR (ads.posted IS NULL AND excluded.posted IS NOT NULL)").bind(js, now)
  ]);
}
function memRowsFromItems(items, make, model, src) {
  const mk = memNorm(make), md = memNorm(model), out = [];
  (items || []).forEach(function (i) { const id = adKey(i.url); if (!id || !(i.price > 0)) return; out.push({ id: id, src: src, mk: mk, md: md, yr: i.year || null, vin: i.vin || null, title: String(i.title || '').slice(0, 90), p: Math.round(i.price), km: i.km != null ? Math.round(i.km) : null, posted: null }); });
  return out;
}
async function memGone(env, url) { const id = adKey(url); if (!id || !(await memInit(env))) return; await env.DB.prepare('UPDATE ads SET gone = ?2 WHERE id = ?1 AND gone IS NULL').bind(id, Date.now()).run(); }
async function memSeller(env, url, token) {
  const id = adKey(url); if (!id || !token || !(await memInit(env))) return;
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('carscout:' + token)))).slice(0, 10).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  await env.DB.prepare('UPDATE ads SET seller = ?2 WHERE id = ?1').bind(id, h).run();
}
async function hMemory(env, q) {
  if (!(await memInit(env))) return json(env, { ok: false, error: 'no_db', message: 'Memory is not connected.' });
  const out = { ok: true };
  const url = q.get('url'), id = adKey(url), vinQ = String(q.get('vin') || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  let me = null;
  if (id) {
    me = await env.DB.prepare('SELECT * FROM ads WHERE id = ?1').bind(id).first();
    if (me) { const h = await env.DB.prepare('SELECT t, p, km FROM hist WHERE id = ?1 ORDER BY t LIMIT 40').bind(id).all(); out.self = { first: { t: me.ft, p: me.fp, km: me.fkm }, last: { t: me.lt, p: me.lp, km: me.lkm }, seen: me.n, hist: h.results || [] }; }
  }
  const vin = vinQ.length === 17 ? vinQ : (me && me.vin) || null;
  if (vin) { const r = await env.DB.prepare('SELECT id, src, title, ft, fp, fkm, lt, lp, lkm, gone FROM ads WHERE vin = ?1 AND id IS NOT ?2 ORDER BY ft LIMIT 10').bind(vin, id).all(); out.vin = r.results || []; }
  if (me && me.seller) { const r = await env.DB.prepare('SELECT id, src, title, yr, ft, fp, fkm, lt, lp, lkm, gone FROM ads WHERE seller = ?1 AND id IS NOT ?2 AND mk = ?3 AND md = ?4 AND (yr IS NULL OR ?5 IS NULL OR ABS(yr - ?5) <= 1) ORDER BY ft LIMIT 10').bind(me.seller, id, me.mk, me.md, me.yr).all(); out.seller = r.results || []; }
  const mk = memNorm(q.get('make') || (me && me.mk)), md = memNorm(q.get('model') || (me && me.md)), yr = parseInt(q.get('year') || (me && me.yr) || '', 10) || null;
  if (mk && md) {
    const r = await env.DB.prepare('SELECT ft, fp, lt, lp, gone, posted FROM ads WHERE mk = ?1 AND md = ?2 AND gone IS NOT NULL AND (?3 IS NULL OR yr IS NULL OR ABS(yr - ?3) <= 2) ORDER BY gone DESC LIMIT 300').bind(mk, md, yr).all();
    const g = r.results || [], days = [], drop = [];
    g.forEach(function (x) { const st = x.posted ? Date.parse(x.posted) : x.ft; if (st && x.gone > st) days.push((x.gone - st) / 86400000); if (x.fp > 0 && x.lp > 0) drop.push((x.lp - x.fp) / x.fp * 100); });
    const med = function (a) { if (!a.length) return null; const b = a.slice().sort(function (x, y) { return x - y; }); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
    const tot = await env.DB.prepare('SELECT COUNT(*) AS n FROM ads WHERE mk = ?1 AND md = ?2').bind(mk, md).first();
    out.market = { sold: g.length, days: g.length >= 5 ? med(days) : null, drop: g.length >= 5 ? med(drop) : null, tracked: tot ? tot.n : 0 };
  }
  return json(env, out);
}

/* Telegram alerts: the app stores its watch list (favourite ads and saved searches) under a random code;
   the scheduled GitHub job reads it by that code and sends the messages. */
function watchCode(q) { const c = String(q.get('code') || ''); return /^[a-z0-9]{16,40}$/.test(c) ? c : null; }
async function hWatchSave(env, q, request) {
  const code = watchCode(q); if (!code) return json(env, { ok: false, error: 'bad_code' }, 400);
  if (!(await memInit(env))) return json(env, { ok: false, error: 'no_db' });
  const txt = await request.text(); if (txt.length > 30000) return json(env, { ok: false, error: 'too_big' }, 413);
  let d; try { d = JSON.parse(txt); } catch (e) { return json(env, { ok: false, error: 'bad_json' }, 400); }
  const clean = {
    lang: /^(ru|en|lv)$/.test(d.lang) ? d.lang : 'en', off: !!d.off,
    favs: (Array.isArray(d.favs) ? d.favs : []).filter(function (f) { return f && allowed(f.url); }).slice(0, 20).map(function (f) { return { url: String(f.url).slice(0, 400), title: String(f.title || '').slice(0, 80), price: +f.price || null }; }),
    hunts: (Array.isArray(d.hunts) ? d.hunts : []).slice(0, 5).map(function (h) { return { key: String(h.key || '').slice(0, 300), name: String(h.name || '').slice(0, 120), p: h.p && typeof h.p === 'object' ? h.p : {} }; })
  };
  await env.DB.prepare('INSERT INTO watch(code, data, t) VALUES(?1, ?2, ?3) ON CONFLICT(code) DO UPDATE SET data = excluded.data, t = excluded.t').bind(code, JSON.stringify(clean), Date.now()).run();
  return json(env, { ok: true, favs: clean.favs.length, hunts: clean.hunts.length });
}
async function hWatchGet(env, q) {
  const code = watchCode(q); if (!code) return json(env, { ok: false, error: 'bad_code' }, 400);
  if (!(await memInit(env))) return json(env, { ok: false, error: 'no_db' });
  const r = await env.DB.prepare('SELECT data, t FROM watch WHERE code = ?1').bind(code).first();
  if (!r) return json(env, { ok: false, error: 'not_found' });
  let d = {}; try { d = JSON.parse(r.data); } catch (e) { }
  return json(env, Object.assign({ ok: true, t: r.t }, d));
}

/* Telegram: the worker reads the bot chat (getUpdates) to link "/start CODE" to a chat at once and answers right away.
   It needs the TG_TOKEN secret (Cloudflare > Worker > Settings > Variables and Secrets). */
const TGT = {
  ru: { linked: '✅ CarScout подключён. Буду присылать снижение цен в избранном и новые выгодные машины из ваших сохранённых поисков. Отключить: /stop', stop: 'Уведомления отключены. Подключить снова можно в приложении CarScout.', help: 'Чтобы подключить уведомления, откройте CarScout → «Избранное» или «Выгодные» → «Подключить Telegram».' },
  lv: { linked: '✅ CarScout pieslēgts. Sūtīšu cenu samazinājumus izlasē un jaunus izdevīgus auto no jūsu saglabātajām meklēšanām. Atslēgt: /stop', stop: 'Paziņojumi atslēgti. Pieslēgt atkal var lietotnē CarScout.', help: 'Lai pieslēgtu paziņojumus, atveriet CarScout → «Izlase» vai «Izdevīgie» → «Pieslēgt Telegram».' },
  en: { linked: '✅ CarScout is connected. I will send price drops in your favourites and new good deals from your saved searches. To turn off: /stop', stop: 'Alerts are off. You can turn them on again in the CarScout app.', help: 'To turn on alerts, open CarScout → “Favourites” or “Deals” → “Connect Telegram”.' }
};
async function tgApi(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
async function kvGet(env, k) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?1').bind(k).first(); return r ? r.v : null; }
async function kvSet(env, k, v) { await env.DB.prepare('INSERT INTO kv(k, v) VALUES(?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run(); }
async function tgPoll(env, force) {
  if (!env.TG_TOKEN || !(await memInit(env))) return { ok: false, error: 'no_tg' };
  const now = Date.now(), last = +(await kvGet(env, 'tg_poll_at') || 0);
  if (!force && now - last < 2500) return { ok: true, skipped: true };
  await kvSet(env, 'tg_poll_at', now);
  const off = +(await kvGet(env, 'tg_offset') || 0);
  const up = await tgApi(env, 'getUpdates', { offset: off + 1, timeout: 0, allowed_updates: ['message'] });
  if (!up.ok) return { ok: false, error: 'tg', message: up.description };
  let max = off, n = 0;
  for (const u of up.result || []) {
    max = Math.max(max, u.update_id); const m = u.message; if (!m || !m.text || !m.chat) continue;
    const lc = (m.from && m.from.language_code) || '', lang = /^ru/.test(lc) ? 'ru' : /^lv/.test(lc) ? 'lv' : 'en';
    const mm = m.text.match(/^\/start(?:\s+([a-z0-9]{16,40}))?/i);
    if (mm && mm[1]) {
      const code = mm[1].toLowerCase();
      await env.DB.prepare("INSERT INTO watch(code, data, t, chat, lang) VALUES(?1, '{}', ?2, ?3, ?4) ON CONFLICT(code) DO UPDATE SET chat = excluded.chat, lang = excluded.lang").bind(code, now, m.chat.id, lang).run();
      await tgApi(env, 'sendMessage', { chat_id: m.chat.id, text: TGT[lang].linked }); n++;
    } else if (mm) await tgApi(env, 'sendMessage', { chat_id: m.chat.id, text: TGT[lang].help });
    else if (/^\/stop/i.test(m.text)) { await env.DB.prepare('UPDATE watch SET chat = NULL WHERE chat = ?1').bind(m.chat.id).run(); await tgApi(env, 'sendMessage', { chat_id: m.chat.id, text: TGT[lang].stop }); }
  }
  if (max > off) await kvSet(env, 'tg_offset', max);
  return { ok: true, linked: n };
}
async function tgAuth(env, request) {
  if (!env.TG_TOKEN) return false;
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('carscout-subs:' + env.TG_TOKEN)))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  return (request.headers.get('x-carscout-auth') || '') === h;
}
async function hTgStatus(env, q) {
  const code = watchCode(q); if (!code) return json(env, { ok: false, error: 'bad_code' }, 400);
  if (!env.TG_TOKEN) return json(env, { ok: false, error: 'no_tg' });
  await tgPoll(env, false).catch(function () { });
  const r = await env.DB.prepare('SELECT chat FROM watch WHERE code = ?1').bind(code).first();
  return json(env, { ok: true, linked: !!(r && r.chat) });
}
async function hTgSubs(env, request) {
  if (!(await tgAuth(env, request))) return json(env, { ok: false, error: 'auth' }, 403);
  await tgPoll(env, true).catch(function () { });
  const r = await env.DB.prepare('SELECT code, chat, lang, data FROM watch WHERE chat IS NOT NULL LIMIT 200').all();
  return json(env, { ok: true, subs: (r.results || []).map(function (x) { let d = {}; try { d = JSON.parse(x.data || '{}'); } catch (e) { } return Object.assign({ code: x.code, chat: x.chat, lang: d.lang || x.lang || 'en' }, d); }) });
}
async function hTgLink(env, q, request) {
  if (!(await tgAuth(env, request))) return json(env, { ok: false, error: 'auth' }, 403);
  const code = watchCode(q), chat = parseInt(q.get('chat') || '', 10); if (!code || !chat) return json(env, { ok: false, error: 'bad' }, 400);
  if (!(await memInit(env))) return json(env, { ok: false, error: 'no_db' });
  await env.DB.prepare("INSERT INTO watch(code, data, t, chat) VALUES(?1, '{}', ?2, ?3) ON CONFLICT(code) DO UPDATE SET chat = excluded.chat").bind(code, Date.now(), chat).run();
  return json(env, { ok: true });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const u = new URL(request.url);
    if (request.method === 'POST' && u.pathname === '/api/watch') { try { return await hWatchSave(env, u.searchParams, request); } catch (e) { return json(env, { ok: false, error: 'worker_error', message: String(e && e.message || e) }, 500); } }
    if (request.method !== 'GET') return json(env, { ok: false, error: 'method' }, 405);
    try {
      if (u.pathname === '/' || u.pathname === '') return json(env, { ok: true, name: 'CarScout Live worker', version: VERSION, endpoints: ['/api/listing', '/api/seller', '/api/comps', '/api/memory', '/api/search', '/api/img', '/api/debug'] });
      if (u.pathname === '/api/listing') return await hListing(env, u.searchParams, ctx);
      if (u.pathname === '/api/comps') return await hComps(env, u.searchParams, ctx);
      if (u.pathname === '/api/memory') return await hMemory(env, u.searchParams);
      if (u.pathname === '/api/watch') return await hWatchGet(env, u.searchParams);
      if (u.pathname === '/api/tg/status') return await hTgStatus(env, u.searchParams);
      if (u.pathname === '/api/tg/subs') return await hTgSubs(env, request);
      if (u.pathname === '/api/tg/link') return await hTgLink(env, u.searchParams, request);
      if (u.pathname === '/api/search') return await hSearch(env, u.searchParams);
      if (u.pathname === '/api/seller') return await hSeller(env, u.searchParams, ctx);
      if (u.pathname === '/api/vinhist') return await hVinHistory(env, u.searchParams);
      if (u.pathname === '/api/debug') return await hDebug(env, u.searchParams);
      if (u.pathname === '/api/img') return await hImg(env, u.searchParams);
      return json(env, { ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json(env, { ok: false, error: 'worker_error', message: String(e && e.message || e) }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tgPoll(env, true).catch(function () { })); }
};
