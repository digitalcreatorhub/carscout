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
  /(^|\.)autoscout24\.[a-z.]+$/, /(^|\.)mobile\.de$/, /(^|\.)otomoto\.pl$/, /(^|\.)autovit\.ro$/, /(^|\.)kleinanzeigen\.de$/
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAKES = ['Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Citroën', 'Citroen', 'Cupra', 'Dacia', 'DS', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Infiniti',
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Mazda', 'Mercedes-Benz', 'Mercedes', 'MINI', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Polestar', 'Porsche',
  'Renault', 'SEAT', 'Seat', 'Škoda', 'Skoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo', 'Chevrolet', 'Chrysler', 'Dodge', 'Saab', 'Lancia', 'GWM','Great Wall','Ora','BYD','Chery','Geely','MG','Lynk & Co','NIO','XPeng','Zeekr','Leapmotor','Haval','Omoda','Jaecoo','Dongfeng','Voyah','Maxus','Lotus'];

/* ---------------- HTTP helpers ---------------- */
function cors(env) {
  return {
    'access-control-allow-origin': (env && env.ALLOW_ORIGIN) || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
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
    cf: { cacheTtl: ttl || 900, cacheEverything: true }
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
function hasLpg(s) { return /\blpg\b|(^|[^а-яёa-z])газ(?![а-яё])|газов|(^|[^а-яё])гбо(?![а-яё])|gāz|\bhbo\b|пропан/i.test(String(s || '')); }
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
  if (/manual|manuāl|механ|handschalt|schalt/.test(s)) return 'manual';
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
  ['make', /^(marka|марка|make)$/], ['model', /^(modelis|модель|model)$/], ['year', /^(izlaiduma gads|год выпуска|year)$/],
  ['engine', /^(dzin[eē]js|dzin[eē]ja tips|motors|двигатель|мотор|тип двигателя|engine|engine type)$/], ['gearbox', /^([aā]trumk[aā]rba|коробка передач|коробка|transmission)$/],
  ['mileage', /^(nobraukums|пробег|mileage)$/], ['color', /^(kr[aā]sa|цвет|colou?r)$/], ['body', /^(virsb[uū]ves tips|тип кузова|body type)$/],
  ['vin', /^(vin|vin kods|vin код)$/]
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
  listing.src = { make: L.make ? 'table' : 'text', model: L.model ? 'table' : 'text', year: L.year ? 'table' : null, mileage_km: L.mileage ? 'table' : null,
    asking_price: price ? 'table' : null, gearbox: L.gearbox ? 'table' : null, fuel: (eng.fuel || normFuel(L.engine)) ? 'table' : (listing.fuel ? 'text' : null), vin: L.vin ? 'table' : (listing.vin ? 'text' : null) };
  const OTHER_MAKE = /^(other|others|cit[sai]s?|citas? marka|citas markas|citi|другая|другие|прочие|прочее|иная|—|-)$/i;
  if (!listing.make || OTHER_MAKE.test(listing.make)) {
    const pageTitle = strip((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let g = guessMakeModel(listing.model || '');
    if (!g.make) g = guessMakeModel(pageTitle);
    if (!g.make) g = guessMakeModel(desc.slice(0, 500));
    if (g.make) { listing.make = g.make; listing.model = g.model || listing.model; } else listing.make = null;
  }
  const nm = cleanMakeModel(listing.make, listing.model); listing.make = nm.make; listing.model = nm.model;
  const m3 = url.match(/\/msg\/[a-z]{2}\/transport\/cars\/others\/[^/]+\.html/i);
  return { listing: listing, hints: { ss_others: !!m3, ss_path: m3 ? '/ru/transport/cars/others/' : m2 ? '/ru/transport/cars/' + m2[1] + '/' + m2[2] + '/' : null, ss_make: m2 ? m2[1] : null, ss_model: m2 ? m2[2] : null } };
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
    let img = null; const im = row.match(/<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i);
    if (im) { const u = absUrl(im[1].replace(/&amp;/g, '&'), base); if (u && imgAllowed(u) && !/(logo|icon|noimage|placeholder|sprite)/i.test(u)) img = u; }
    items.push({ price: Math.round(price), km: km, year: year, url: link ? absUrl(link[1], base) : null, title: title.slice(0, 160), fuel: e.fuel || null, engine_l: e.engine_l || null, img: img });
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
  return items.filter(function (i) { const k = (i.url || '') + '|' + i.price + '|' + i.km + '|' + i.year; if (seen[k]) return false; seen[k] = 1; return true; });
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
  /(^|\.)ss\.(com|lv)$/, /(^|\.)autoscout24\.(net|com|de)$/, /(^|\.)autoplius\.lt$/, /(^|\.)dgn\.lt$/, /(^|\.)auto24\.(ee|lv|lt)$/,
  /(^|\.)olxcdn\.com$/, /(^|\.)classistatic\.de$/, /(^|\.)autovit\.ro$/
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
async function hListing(env, q) {
  const url = q.get('url');
  if (!url || !allowed(url)) return json(env, { ok: false, error: 'bad_url', message: 'Link missing or site not supported.' }, 400);
  const host = new URL(url).hostname;
  const p = await getPage(url, 600);
  const b = blockedBy(p);
  if (b) return json(env, { ok: false, error: 'blocked', message: 'The site refused the server request (' + b + ').', diag: { status: p.status, bytes: p.text.length } });
  if (p.status === 404) return json(env, { ok: false, error: 'not_found', message: 'Listing page not found (removed or wrong link).' });
  let res, parser;
  if (/(^|\.)ss\.(com|lv)$/.test(host) && /\/msg\//.test(url)) {
    res = parseSsListing(p.text, p.url); parser = 'ss';
    const g = parseGenericListing(p.text, p.url);
    res.image = g.image; res.title = g.title;
    Object.keys(g.listing).forEach(function (k) { if (k === 'fuel') return; if (res.listing[k] == null || res.listing[k] === '') res.listing[k] = g.listing[k]; });
  } else { res = parseGenericListing(p.text, p.url); parser = 'generic'; res.hints = {}; }
  const L = res.listing;
  const filled = ['make', 'model', 'year', 'mileage_km', 'asking_price'].filter(function (k) { return L[k] != null; }).length;
  return json(env, { ok: filled >= 2, error: filled >= 2 ? null : 'parse_failed', message: filled >= 2 ? null : 'Could not read the main fields from this page.', source: host, parser: parser,
    listing: L, image: res.image || null, images: collectImages(p.text, p.url), title: res.title || null, hints: res.hints || {}, diag: { status: p.status, bytes: p.text.length, filled: filled } });
}

function filterOthers(items, make, model) {
  const w = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); };
  const has = function (t, s) { return !!s && (' ' + w(t) + ' ').indexOf(' ' + s + ' ') > -1; };
  const mk = w(make), md = w(model);
  const byModel = items.filter(function (i) { return md && has(i.title, md); });
  if (byModel.length >= 3) return byModel;
  return items.filter(function (i) { return (md && has(i.title, md)) || has(i.title, mk) || (mk === 'gwm' && (has(i.title, 'great wall') || has(i.title, 'ora'))); });
}
async function hComps(env, q) {
  const source = q.get('source');
  const cm = cleanMakeModel(q.get('make') || '', q.get('model') || '');
  const make = cm.make || '', model = cm.model || '';
  const year = parseInt(q.get('year') || '', 10) || null;
  if (source === 'ss') {
    let path = q.get('ssPath');
    let others = !!path && /^\/[a-z]{2}\/transport\/cars\/others\/$/i.test(path);
    if (!others && (!path || !/^\/[a-z]{2}\/transport\/cars\/[a-z0-9\-]+\/[a-z0-9\-]+\/$/i.test(path))) {
      let mk = slugify(make); if (mk === 'mercedes-benz') mk = 'mercedes'; if (mk === 'vw') mk = 'volkswagen';
      let md = slugify(model);
      if (/^bmw$/.test(mk) && /^\d{3}[a-z]*$/.test(md)) md = md.slice(0, 3);
      if (mk === 'toyota' && md === 'rav4') md = 'rav-4';
      if (mk === 'mercedes') { const mm2 = md.match(/^([a-z]{1,4})-?(\d{2,3})(?!\d)/); if (mm2) md = mm2[1] + mm2[2]; }
      if (!mk || !md) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
      path = '/ru/transport/cars/' + mk + '/' + md + '/';
    }
    let base = 'https://www.ss.com' + path;
    const fetchSs = function (b, n) { const us = [b]; for (let k = 2; k <= n; k++) us.push(b + 'page' + k + '.html'); return Promise.all(us.map(function (u) { return getPage(u, 900).catch(function (e) { return { status: 0, text: '', url: u, err: String(e) }; }); })); };
    let pages = await fetchSs(base, others ? 8 : 5);
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
    return json(env, { ok: items.length > 0, source: 'ss', region: 'LV', label: 'ss.com', searchUrl: base, items: items, pages: pages.filter(function (p) { return p.status === 200; }).length, error: items.length ? null : 'parse_failed', message: items.length ? null : 'Page loaded but no ads were recognised.' });
  }
  if (source === 'as24de') {
    let mk = slugify(make); if (mk === 'mercedes') mk = 'mercedes-benz'; if (mk === 'vw') mk = 'volkswagen';
    let md = as24Model(mk, slugify(model));
    if (mk === 'gwm' && /^ora/.test(md)) { mk = 'ora'; md = ''; }
    if (!mk || (!md && mk !== 'ora')) return json(env, { ok: false, error: 'need_model', message: 'Make and model are required.' });
    const fuelCode = { diesel: 'D', petrol: 'B', electric: 'E', lpg: 'L' }[q.get('fuel')] || '';
    const f = (fuelCode ? '&fuel=' + fuelCode : '') + (year ? '&fregfrom=' + (year - 1) + '&fregto=' + (year + 1) : '');
    const trim = String(q.get('trim') || '').replace(/[^A-Za-z0-9 \-+&]/g, '').trim().slice(0, 30);
    const mkUrlV = function (p, tv) { return 'https://www.autoscout24.com/lst/' + mk + (md ? '/' + md : '') + '?atype=C&cy=D&damaged_listing=exclude&desc=0' + f + (tv ? '&version=' + encodeURIComponent(tv) : '') + '&sort=standard&ustate=N%2CU&page=' + p; };
    const fetchSet = function (tv) { return Promise.all([1, 2, 3].map(function (n) { return getPage(mkUrlV(n, tv), 900).catch(function (e) { return { status: 0, text: '', url: mkUrlV(n, tv) }; }); })); };
    let usedTrim = '';
    let pages = await fetchSet(trim);
    if (trim && pages[0].status === 200 && !blockedBy(pages[0]) && parseAs24List(pages[0].text, 'https://www.autoscout24.com/lst/').length >= 3) usedTrim = trim;
    else if (trim) pages = await fetchSet('');
    const mkUrl = function (p) { return mkUrlV(p, usedTrim); };
    const b = blockedBy(pages[0]);
    const search = mkUrl(1);
    if (b) return json(env, { ok: false, source: 'as24de', error: 'blocked', message: 'AutoScout24 refused the server request (' + b + ').', searchUrl: search });
    if (pages[0].status === 404) return json(env, { ok: false, source: 'as24de', error: 'not_found', message: 'Make/model not found on AutoScout24.', searchUrl: search });
    let items = [];
    pages.forEach(function (p) { if (p.status === 200) items = items.concat(parseAs24List(p.text, 'https://www.autoscout24.com/lst/')); });
    items = dedupe(items);
    if (/\/lst\//.test(pages[0].url || '') === false || (pages[0].url || '').toLowerCase().indexOf('/lst/' + mk) === -1) return json(env, { ok: false, source: 'as24de', error: 'not_found', message: 'AutoScout24 redirected away from this make/model.', searchUrl: search });
    if (year && items.length >= 10) {
      const inY = items.filter(function (i) { return i.year == null || Math.abs(i.year - year) <= 1; }).length;
      if (inY / items.length < 0.5) return json(env, { ok: false, source: 'as24de', error: 'filters_ignored', message: 'AutoScout24 did not apply the model/year filters.', searchUrl: search });
    }
    if (usedTrim) items.forEach(function (i) { i.trimMatch = usedTrim; });
    return json(env, { ok: items.length > 0, source: 'as24de', region: 'DE', label: 'AutoScout24 (DE)', searchUrl: search, trimFilter: usedTrim || null, items: items, error: items.length ? null : 'parse_failed', message: items.length ? null : 'Page loaded but no ads were recognised.' });
  }
  return json(env, { ok: false, error: 'bad_source', message: 'Unknown source.' }, 400);
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
    textStart: strip(p.text).slice(0, 500)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== 'GET') return json(env, { ok: false, error: 'method' }, 405);
    const u = new URL(request.url);
    try {
      if (u.pathname === '/' || u.pathname === '') return json(env, { ok: true, name: 'CarScout Live worker', version: VERSION, endpoints: ['/api/listing', '/api/comps', '/api/search', '/api/img', '/api/debug'] });
      if (u.pathname === '/api/listing') return await hListing(env, u.searchParams);
      if (u.pathname === '/api/comps') return await hComps(env, u.searchParams);
      if (u.pathname === '/api/search') return await hSearch(env, u.searchParams);
      if (u.pathname === '/api/debug') return await hDebug(env, u.searchParams);
      if (u.pathname === '/api/img') return await hImg(env, u.searchParams);
      return json(env, { ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json(env, { ok: false, error: 'worker_error', message: String(e && e.message || e) }, 500);
    }
  }
};
