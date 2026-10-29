// CarScout check of the page readers of the worker (worker/worker.js) that lifecheck.mjs does not cover:
// ss.com / ss.lv (the main market: list rows and ad pages in RU, LV and EN), AutoScout24 (list and ad page),
// autoplius.lt, autoportaal.ee, the generic reader, and the small functions every reader uses (mileage, year, fuel,
// gearbox, LPG, VIN, make and model, which sites are allowed, what counts as a bot check).
//
// IMPORTANT: the pages below are BUILT HERE from what each reader looks for (names of the table rows, class names, data
// attributes, JSON fields). They are not saved copies of the live sites: the live sites cannot be reached from where this
// was written. So this check catches a change in OUR code that breaks a reader; it cannot notice that a site changed its
// markup. That is what the daily self-check (tools/selfcheck.mjs, real ads through the live worker) is for. When the daily
// check reports a reader failing on a real page, put the smallest piece of that page that shows the problem into a builder
// here and add the expected values, so the problem can never come back unnoticed.
// No network. Run: node tools/parsercheck.mjs   (Node 22+)
import { loadWorker, checker } from './lib/offline.mjs';

const { check, finish } = checker('page readers');
const { ctx, W, pages, calls } = loadWorker();
ctx.env = { ALLOW_ORIGIN: '*' };
const P = (expr) => JSON.parse(W('JSON.stringify(' + expr + ')') ?? 'null');
const run = (fn, html, url) => { ctx.__h = html; ctx.__u = url; return P(`${fn}(__h, __u)`); };
const api = async (path) => JSON.parse(await W(`__worker.fetch(new Request('https://carscout.test${path}'), env, { waitUntil() {} }).then(function (r) { return r.text(); })`));

/* =====================================================================================================================
   1. small functions
   ===================================================================================================================== */
const table = (name, fn, rows) => { const bad = []; for (const [input, want] of rows) { ctx.__i = input; const got = P(`${fn}(__i)`); if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ input, want, got }); } check(!bad.length, `${name}: ${rows.length} cases`, bad); };

table('mileage (parseKm)', 'parseKm', [['187 тыс.', 187000], ['187 000', 187000], ['187000', 187000], ['120k', 120000], ['45,5 tkm', 45500], ['12.345', 12345], ['1 234 567', 1234567], ['187 tūkst.', 187000], ['', null], ['n/a', null]]);
table('year (parseYear)', 'parseYear', [['2016', 2016], ['Year: 2019', 2019], ['06/2018', 2018], ['1989', 1989], ['1979', null], ['12016', null], ['', null]]);
table('fuel word (normFuel)', 'normFuel', [['Diesel', 'diesel'], ['Dīzelis', 'diesel'], ['Дизель', 'diesel'], ['D', 'diesel'], ['Benzīns', 'petrol'], ['Бензин', 'petrol'], ['Petrol', 'petrol'], ['Hybrid', 'hybrid'], ['Hibrīds', 'hybrid'], ['Elektro', 'electric'], ['Электро', 'electric'], ['Gāze', 'lpg'], ['', null], ['unknown fuel', null]]);
table('gearbox (normGear)', 'normGear', [['Automatic', 'automatic'], ['Automāts', 'automatic'], ['Автомат', 'automatic'], ['DSG', 'automatic'], ['Manual', 'manual'], ['Manuāla', 'manual'], ['Механика', 'manual'], ['Handschaltung', 'manual'], ['', null]]);
table('gas installation (hasLpg)', 'hasLpg', [['Benzīns/Gāze', true], ['Бензин/Газ', true], ['ГБО 4 поколения', true], ['газ/бензин', true], ['LPG', true], ['Gāzes iekārta', true], ['petrol/gas', true], ['Газель 3302', false], ['Бензин', false], ['Dīzelis', false], ['Hybrid petrol', false], ['', false]]);
table('first fuel word in a text (fuelEarliest)', 'fuelEarliest', [['VW Golf 1.6 TDI', 'diesel'], ['Audi A4 2.0 TFSI', 'petrol'], ['Toyota Auris Hybrid', 'hybrid'], ['Skoda Octavia benzin + LPG', 'petrol'], ['Opel Astra LPG', 'lpg'], ['Tesla Model 3 electric car', 'electric'], ['Diesel hybrid', 'diesel'], ['Golf', null], ['', null]]);
table('engine text (parseEngine)', 'parseEngine', [['2.0D', { engine_l: 2, fuel: 'diesel' }], ['1.6', { engine_l: 1.6, fuel: 'petrol' }], ['1.8H', { engine_l: 1.8, fuel: 'hybrid' }], ['1,4 Benzīns', { engine_l: 1.4, fuel: 'petrol' }], ['3.0 Dīzelis', { engine_l: 3, fuel: 'diesel' }], ['2.0 Diesel', { engine_l: 2, fuel: 'diesel' }], ['', {}]]);
table('VIN in a text (vinIn)', 'vinIn', [['VIN: WVWZZZAUZGW123456 pārdod', 'WVWZZZAUZGW123456'], ['wvwzzzauzgw123456', 'WVWZZZAUZGW123456'], ['AAAAAAAAAAAAAAAAA', null], ['12345678901234567', null], ['WVWZZZAUZGWI23456', null], ['no vin here', null], ['', null]]);
table('url name (slugify)', 'slugify', [['Škoda Octavia', 'skoda-octavia'], ['Citroën C4 Picasso', 'citroen-c4-picasso'], ['  Land Rover ', 'land-rover'], ['', '']]);
table('number (toNum)', 'toNum', [['11 900', 11900], ['11.900', 11900], ['11 900 €', 11900], ['9,5', 9.5], ['', null], ['abc', null]]);
{
  const cm = (a, b) => { ctx.__a = a; ctx.__b = b; return P('cleanMakeModel(__a, __b)'); };
  const rows = [[['Volkswagen', 'Golf 7'], { make: 'Volkswagen', model: 'Golf 7' }], [['VW', 'Golf'], { make: 'Volkswagen', model: 'Golf' }], [['Mercedes', 'E 220'], { make: 'Mercedes-Benz', model: 'E 220' }], [['Skoda', 'Octavia'], { make: 'Škoda', model: 'Octavia' }],
    [['Audi A6 allroad', ''], { make: 'Audi', model: 'A6' }], [['Tesla', 'Tesla Model 3'], { make: 'Tesla', model: 'Model 3' }], [['Rover Range Rover Evoque', ''], { make: 'Land Rover', model: 'Range Rover Evoque' }], [['', ''], { make: null, model: null }]];
  const bad = rows.filter(([[a, b], want]) => JSON.stringify(cm(a, b)) !== JSON.stringify(want)).map(([i, want]) => ({ i, want, got: cm(...i) }));
  check(!bad.length, `make and model (cleanMakeModel): ${rows.length} cases`, bad);
}
table('make and model from a title (guessMakeModel)', 'guessMakeModel', [['Volkswagen Golf 7 1.6 TDI', { make: 'Volkswagen', model: 'Golf' }], ['BMW 520d xDrive', { make: 'BMW', model: '520d' }], ['Tesla Model 3 Long Range', { make: 'Tesla', model: 'Model 3' }], ['Mercedes-Benz E 220 d', { make: 'Mercedes-Benz', model: 'E' }],
  ['Lietota Toyota RAV4 2.0', { make: 'Toyota', model: 'RAV4' }], ['VW Passat', { make: 'Volkswagen', model: 'Passat' }], ['nothing useful', { make: null, model: null }]]);
{
  const f = (code) => P(code);
  check(JSON.stringify([f("as24Model('mercedes-benz', 'e-350')"), f("as24Model('mercedes-benz', 'e350')"), f("as24Model('bmw', '520d')"), f("as24Model('bmw', 'x5')"), f("as24Model('audi', 'a6')")]) === JSON.stringify(['e-350', 'e-350', '520', 'x5', 'a6']), 'AutoScout24 model names (as24Model): Mercedes "e350" -> "e-350", BMW "520d" -> "520", others unchanged');
  check(JSON.stringify([f("modelFamilyOk('bmw', '5series', '520d')"), f("modelFamilyOk('bmw', '5series', '320d')"), f("modelFamilyOk('bmw', '5series', 'm5')"), f("modelFamilyOk('mercedes-benz', 'eclass', 'e220')"), f("modelFamilyOk('mercedes-benz', 'eclass', 'c220')"), f("modelFamilyOk('mazda', 'mazda6', '6')"), f("modelFamilyOk('audi', 'a6', 'a4')")]) === JSON.stringify([true, false, true, true, false, true, false]), 'model line against an exact model (modelFamilyOk): 5 Series has 520d, not 320d; E-Class has E 220, not C 220');
}
{
  /* "no accidents" is not "damaged": phone-alert filter must keep such cars and still drop real damaged ones */
  const good = ['Bez avārijām, pirmais īpašnieks', 'Nav bojāts, bez bojājumiem', 'Без аварий, один владелец', 'Unfallfrei, Scheckheft', 'Accident free, 1 owner', 'Ohne Unfall'];
  const bad = ['Pēc avārijas, jāremontē', 'Bojāts priekšgals', 'Битая, на запчасти', 'Damaged front end', 'Unfall, Motorschaden', 'Bez avārijām, bet uz daļām'];
  const wrongKept = bad.filter(t => !P(`pzIsBad(${JSON.stringify(t)})`)), wrongDropped = good.filter(t => P(`pzIsBad(${JSON.stringify(t)})`));
  check(!wrongKept.length && !wrongDropped.length, 'damaged-car filter (pzIsBad): "bez avārijām", "без аварий", "unfallfrei" are NOT damaged; real damage words still are', { wrongKept, wrongDropped });
}
{
  const ok = (u) => P(`allowed(${JSON.stringify(u)})`);
  const yes = ['https://www.ss.com/msg/ru/x.html', 'https://ss.lv/', 'https://www.autoscout24.de/angebote/x', 'https://en.autoplius.lt/ads/x.html', 'https://autoportaal.ee/et/x', 'https://www.auto24.lv/lietoti/1'];
  const no = ['https://evil.com/?u=ss.com', 'https://ss.com.evil.com/', 'https://notss.com/', 'http://localhost/', 'ftp://ss.com/', 'javascript:alert(1)', 'not a url', 'https://169.254.169.254/'];
  check(yes.every(ok) && !no.some(ok), 'only the supported car sites are fetched (allowed): look-alike hosts, other schemes and internal addresses are refused', { wronglyRefused: yes.filter(u => !ok(u)), wronglyAllowed: no.filter(ok) });
}
{
  const b = (status, text) => { ctx.__p = { status, text }; return P('blockedBy(__p)'); };
  check(b(403, 'x') === 'HTTP 403' && b(429, 'x') === 'HTTP 429' && b(503, 'x') === 'HTTP 503', 'a refusal by the site (403, 429, 503) is recognised as a block');
  check(b(200, '<html><title>Just a moment...</title></html>') === 'anti-bot page' && b(200, '<h1>Pardon Our Interruption</h1>') === 'anti-bot page', 'a bot-check page is recognised');
  check(b(200, '<html> captcha ' + 'x'.repeat(90000) + '</html>') === null && b(200, '<html>normal page</html>') === null && b(404, 'x') === null, 'a long normal page that mentions "captcha" is not a block; a plain 404 is not a block');
}
{
  const im = (u) => P(`imgAllowed(${JSON.stringify(u)})`);
  check(im('https://i.ss.com/gallery/6/1/1/61600001.th2.jpg') && im('https://prod.pictures.autoscout24.net/x.webp') && !im('http://i.ss.com/a.jpg') && !im('https://evil.com/a.jpg'), 'photos only from the car sites and only over https (imgAllowed)');
  ctx.__h = '<html><meta property="og:image" content="https://i.ss.com/gallery/6/1/1/61600009.800.jpg"><img src="https://i.ss.com/gallery/6/1/1/61600001.th2.jpg"><img src="https://i.ss.com/gallery/6/1/1/61600001.800.jpg"><img src="https://i.ss.com/gallery/6/1/1/61600002.t.jpg"><img src="https://i.ss.com/img/logo.png"><img src="https://evil.com/x.jpg"></html>';
  const ims = P("collectImages(__h, 'https://www.ss.com/msg/ru/transport/cars/vw/golf/abcdef.html')");
  check(JSON.stringify(ims.slice().sort()) === JSON.stringify(['https://i.ss.com/gallery/6/1/1/61600001.800.jpg', 'https://i.ss.com/gallery/6/1/1/61600002.800.jpg', 'https://i.ss.com/gallery/6/1/1/61600009.800.jpg']), 'photos: thumbnails become full size, a thumbnail and its full size count once, logos and other sites are left out', ims);
}
{
  const d = P("dedupe([{url:'https://www.ss.com/msg/ru/a/abcd12.html',price:1}, {url:'https://www.ss.com/msg/lv/a/abcd12.html',price:1}, {url:'https://www.autoscout24.com/offers/aaa-bbb',price:2}, {url:'https://www.autoscout24.com/offers/aaa-bbb?x=1',price:2}, {url:null,price:5,km:1,year:2010}, {url:null,price:5,km:1,year:2010}, {url:null,price:6,km:1,year:2010}])");
  check(d.length === 4, 'the same ad twice (another language, a tracking parameter) counts once; ads without a link are told apart by price, mileage and year', d.length);
}

/* =====================================================================================================================
   2. ss.com / ss.lv: the list of one model
   ===================================================================================================================== */
const SSL = 'https://www.ss.com/ru/transport/cars/volkswagen/golf-7/';
const ssRow = (id, o) => `<tr id="tr_${id}"><td class="msga2"><input type="checkbox" name="mid[]" value="${id}"></td><td class="msga2"><div class="d1"><a href="/msg/ru/transport/cars/volkswagen/golf-7/${o.slug || 'abcdef'}.html" id="im${id}"><img src="${o.img ?? 'https://i.ss.com/gallery/6/1/1/' + id + '.th2.jpg'}" class="isfoto foto_list" alt="Фото"></a></div></td>` +
  `<td class="msg2"><div class="d1"><a href="/msg/ru/transport/cars/volkswagen/golf-7/${o.slug || 'abcdef'}.html" id="dm_${id}" class="am">${o.title}</a></div></td><td class="msga2-o pp6">${o.model ?? 'Golf 7'}</td>` +
  (o.year != null ? `<td class="msga2-o pp6">${o.year}</td>` : '') + (o.eng != null ? `<td class="msga2-o pp6">${o.eng}</td>` : '') + (o.km != null ? `<td class="msga2-o pp6">${o.km}</td>` : '') + (o.price != null ? `<td class="msga2-o pp6" nowrap="nowrap">${o.price}</td>` : '') + '</tr>';
const ssList = [
  ssRow(55000001, { slug: 'aaaaaa', title: 'VW Golf 7 1.6 TDI Comfortline, один владелец', year: 2016, eng: '1.6D', km: '187 тыс.', price: '11&nbsp;900&nbsp;&nbsp;€' }),
  ssRow(55000002, { slug: 'bbbbbb', title: 'Golf 7 1.4 TSI', year: 2015, eng: '1.4', km: '154000', price: '10 500  €' }),
  ssRow(55000003, { slug: 'cccccc', title: 'Golf 7 GTE', year: 2017, eng: '1.4H', km: '90 тыс.', price: '17 900  €' }),
  ssRow(55000004, { slug: 'dddddd', title: 'Golf 7 e-Golf', year: 2018, eng: 'Электро', km: '60 тыс.', price: '14 200  €' }),
  ssRow(55000005, { slug: 'eeeeee', title: 'Golf 7 Variant 2.0 TDI, пробег 187 000 km', year: 2014, eng: '2.0D', price: '9 500  € / 120 €/мес' }),
  ssRow(55000006, { slug: 'ffffff', title: 'Golf 7 на запчасти', year: 2013, eng: '1.6D', km: '250 тыс.', price: '150  €' }),
  ssRow(55000007, { slug: 'gggggg', title: 'Golf 7 без года', eng: '1.6D', km: '100 тыс.', price: '9 000  €' }),
  ssRow(55000008, { slug: 'hhhhhh', title: 'Golf 7 цена договорная', year: 2012, eng: '1.6D', km: '200 тыс.', price: 'Договорная' }),
  '<tr id="tr_bnr_1"><td>Реклама 5 000 €</td></tr>'
].join('\n');
{
  const it = run('parseSsList', `<html><table><tr><th>Объявление</th></tr>${ssList}</table></html>`, SSL);
  check(it.length === 5, 'ss.com list: 5 usable rows of 9 (a 150 € row, a row without a year, a row without a price and the advertising row are dropped)', it.map(x => x.url));
  const [a, b, c, d, e] = it;
  check(a.price === 11900 && a.year === 2016 && a.km === 187000 && a.engine_l === 1.6 && a.fuel === 'diesel' && a.url === 'https://www.ss.com/msg/ru/transport/cars/volkswagen/golf-7/aaaaaa.html', 'ss.com list: price with non-breaking spaces, year, "187 тыс." as 187000, 1.6D as diesel 1.6, absolute link', a);
  check(a.title === 'VW Golf 7 1.6 TDI Comfortline, один владелец' && a.img === 'https://i.ss.com/gallery/6/1/1/55000001.th2.jpg', 'ss.com list: the longest link text is the title; the photo is taken', { t: a.title, i: a.img });
  check(b.km === 154000 && b.fuel === 'petrol' && b.engine_l === 1.4, 'ss.com list: mileage written as a plain number; engine without a letter is petrol', b);
  check(c.fuel === 'hybrid' && c.engine_l === 1.4, 'ss.com list: 1.4H is a hybrid', c);
  check(d.fuel === null && d.engine_l === null && d.km === 60000 && d.price === 14200, 'ss.com list: an electric car has no engine size or fuel in the list (the ad page has it); the rest is read', d);
  check(e.price === 9500 && e.km === 187000, 'ss.com list: a monthly-instalment note after the price is ignored; with no mileage column the mileage is taken from the title', e);
}
{
  const list = ssRow(55000010, { slug: 'zzzzzz', title: 'Golf', year: 2016, eng: '1.6D', km: '100 тыс.', price: '8 000  €', img: 'https://i.ss.com/img/logo.png' });
  check(run('parseSsList', list, SSL)[0].img === null, 'ss.com list: a logo or any non-photo image is never used as the photo');
  check(run('parseSsList', '<html>no rows at all</html>', SSL).length === 0, 'ss.com list: a page without rows gives an empty list, not an error');
}

/* =====================================================================================================================
   3. ss.com / ss.lv: one ad page, in the three site languages
   ===================================================================================================================== */
const SSL_LABELS = {
  ru: { make: 'Марка', model: 'Модель', year: 'Год выпуска', engine: 'Двигатель', gear: 'Коробка передач', km: 'Пробег', color: 'Цвет', body: 'Тип кузова', vin: 'VIN', diesel: '1.6 Дизель', auto: 'Автомат', kmv: '187 000 км', date: 'Дата' },
  lv: { make: 'Marka', model: 'Modelis', year: 'Izlaiduma gads', engine: 'Dzinējs', gear: 'Ātrumkārba', km: 'Nobraukums', color: 'Krāsa', body: 'Virsbūves tips', vin: 'VIN kods', diesel: '1.6 Dīzelis', auto: 'Automāts', kmv: '187 000 km', date: 'Datums' },
  en: { make: 'Make', model: 'Model', year: 'Year of manufacture', engine: 'Engine', gear: 'Transmission', km: 'Mileage', color: 'Colour', body: 'Body type', vin: 'VIN', diesel: '1.6 Diesel', auto: 'Automatic', kmv: '187 000 km', date: 'Date' }
};
const ssAd = (o = {}) => {
  const L = SSL_LABELS[o.lang || 'ru'], row = (name, val) => val == null ? '' : `<tr><td class="ads_opt_name">${name}:</td><td class="ads_opt" id="tdo_x">${val}</td></tr>`;
  const price = o.price === undefined ? '11&nbsp;900&nbsp;&nbsp;€' : o.price;
  return `<html><head><title>${o.pageTitle ?? 'Продажа: Volkswagen Golf 7 1.6 TDI, 2016 | SS.COM'}</title></head><body>` +
    `<div id="msg_div_msg" class="msg_div_msg">${o.desc ?? 'Продаю Golf 7 1.6 TDI в хорошем состоянии, один владелец, обслуживание у официального дилера, второй комплект резины.'}<div id="pic_dv_1" class="pic_dv_thumbnail"><a href="https://i.ss.com/gallery/6/1/1/61600001.800.jpg"><img src="https://i.ss.com/gallery/6/1/1/61600001.th2.jpg"></a></div></div>` +
    `<table class="options_list" width="100%">${row(L.make, o.make ?? 'Volkswagen')}${row(L.model, o.model === undefined ? 'Golf 7' : o.model)}${row(L.year, o.year === undefined ? '2016' : o.year)}${row(L.engine, o.engine === undefined ? L.diesel : o.engine)}${row(L.gear, o.gear ?? L.auto)}${row(L.km, o.km === undefined ? L.kmv : o.km)}${row(L.color, 'Серый')}${row(L.body, 'Универсал')}${row(L.vin, o.vin === undefined ? 'WVWZZZAUZGW123456' : o.vin)}` +
    (price ? `<tr><td class="ads_opt_name">Цена:</td><td class="ads_price" id="tdo_8">${price}</td></tr>` : '') + '</table>' +
    '<table id="contacts_table"><tr><td class="ads_contacts_name">Место:</td><td class="ads_contacts">Рига</td></tr><tr><td class="ads_contacts_name">Адрес:</td><td class="ads_contacts">Brīvības iela 1 <a href="https://www.ss.com/map/?c=56.95123, 24.11334&z=15">карта</a></td></tr></table>' +
    `<script src="/js/${o.lang || 'ru'}/2026-09-28/contacts.js"></script><input type="hidden" value="55012345_1"><div class="msg_footer">${L.date}: 02.10.2026 14:35</div></body></html>`;
};
const SSA = 'https://www.ss.com/msg/ru/transport/cars/volkswagen/golf-7/aaaaaa.html';
{
  const r = run('parseSsListing', ssAd(), SSA), l = r.listing;
  check(l.make === 'Volkswagen' && l.model === 'Golf 7' && l.year === 2016 && l.mileage_km === 187000 && l.asking_price === 11900, 'ss.com ad (RU): make, model, year, mileage and price from the table (price with non-breaking spaces)', l);
  check(l.fuel === 'diesel' && l.engine_l === 1.6 && l.gearbox === 'automatic' && l.lpg === false && l.color === 'Серый' && l.body === 'Универсал', 'ss.com ad (RU): diesel 1.6, automatic, no gas installation, colour and body', l);
  check(l.vin === 'WVWZZZAUZGW123456' && l.src.vin === 'table', 'ss.com ad (RU): the VIN is read from the VIN row and marked as table data', { vin: l.vin, src: l.src.vin });
  check(l.posted === '2026-09-28' && l.updated === '2026-10-02T14:35' && l.ss_id === '55012345', 'ss.com ad (RU): the first publication date (from the script path), the last raise (footer) and the ad number', { p: l.posted, u: l.updated, id: l.ss_id });
  check(l.place === 'Рига' && /Brīvības iela 1/.test(l.address) && l.geo && l.geo.lat === 56.95123 && l.geo.lon === 24.11334, 'ss.com ad (RU): place, address and map position', { place: l.place, addr: l.address, geo: l.geo });
  check(/один владелец/.test(l.description) && !/Марка|Серый/.test(l.description), 'ss.com ad (RU): the description is the ad text only, it stops before the options table', l.description);
  check(l.removed === false && r.hints.ss_path === '/ru/transport/cars/volkswagen/golf-7/' && r.hints.ss_make === 'volkswagen' && r.hints.ss_model === 'golf-7', 'ss.com ad: it is not marked removed; the category path for the similar-cars search is taken from the link', { removed: l.removed, hints: r.hints });
  const lv = run('parseSsListing', ssAd({ lang: 'lv' }), SSA.replace('/ru/', '/lv/')).listing, en = run('parseSsListing', ssAd({ lang: 'en' }), SSA.replace('/ru/', '/en/')).listing;
  const same = ['make', 'model', 'year', 'mileage_km', 'asking_price', 'fuel', 'engine_l', 'gearbox', 'vin', 'posted'].filter(k => JSON.stringify(lv[k]) !== JSON.stringify(l[k]) || JSON.stringify(en[k]) !== JSON.stringify(l[k]));
  check(!same.length, 'the same ad in Latvian and English gives the same data as in Russian (the daily check compares the three languages on real ads)', same.map(k => [k, l[k], lv[k], en[k]]));
}
{
  const g = (o) => run('parseSsListing', ssAd(o), SSA).listing;
  const gas = g({ engine: '1.4 Бензин/Газ', gear: 'Механика', desc: 'Продаю Golf 7 1.4 TSI с газовым оборудованием, всё работает отлично, документы в порядке, торг.' });
  check(gas.fuel === 'petrol' && gas.lpg === true && gas.gearbox === 'manual', 'ss.com ad: petrol + gas is a petrol car with a gas installation (fuel petrol, lpg true)', gas);
  /* ss.com in English writes "gasoline/gas" (a real BMW 418 ad, 20 Oct 2026: the daily check found lpg true in LV and RU, false in EN) */
  const gasEn = g({ engine: '1.9 gasoline/gas', gear: 'Manual', desc: 'BMW 418 in good condition, documents in order, price negotiable, call any time.' });
  check(gasEn.fuel === 'petrol' && gasEn.lpg === true, 'ss.com ad (EN): "gasoline/gas" is a petrol car with a gas installation, as in Latvian and Russian', gasEn);
  const hbo = g({ engine: '1.4', desc: 'Автомобиль в отличном состоянии, установлено ГБО 4 поколения, расход газа маленький, торг уместен.' });
  check(hbo.fuel === 'petrol' && hbo.lpg === true, 'ss.com ad: a gas installation named only in the text (ГБО) is found', hbo);
  const dsl = g({ engine: '2.0 Дизель', desc: 'Дизель, без газа и других переделок, продаю потому что купил новую машину, всё в порядке.' });
  check(dsl.fuel === 'diesel' && dsl.lpg === false, 'ss.com ad: a diesel car is never marked as having a gas installation', dsl);
  const noEng = g({ engine: null, desc: 'Бензиновый Golf 7 1.4 TSI, один владелец, обслуживание у дилера, второй комплект резины в подарок.' });
  check(noEng.fuel === 'petrol' && noEng.src.fuel === 'text', 'ss.com ad: with no engine row the fuel is taken from the ad text and marked as text data', noEng);
  const km = g({ km: '45 тыс.' });
  check(km.mileage_km === 45000, 'ss.com ad: "45 тыс." mileage', km.mileage_km);
  const other = g({ make: 'Другая марка', model: 'Cupra Formentor 1.5 TSI', pageTitle: 'Продажа: Cupra Formentor | SS.COM' });
  check(other.make === 'Cupra' && other.model === 'Formentor', 'ss.com ad: "other make" with the car named in the model row: make and model are found from the name', { make: other.make, model: other.model });
  const comb = g({ make: 'Audi A6 allroad', model: null });
  check(comb.make === 'Audi' && comb.model === 'A6', 'ss.com ad: make and model together in the make row are split', { make: comb.make, model: comb.model });
}
{
  const r = run('parseSsListing', '<html><head><title>SS.COM</title></head><body><div id="msg_div_msg">Объявление удалено или срок его размещения истёк.</div></body></html>', SSA);
  check(r.listing.removed === true && r.listing.asking_price === null, 'ss.com: an expired ad page (no price, year or mileage) is marked removed');
}

/* the whole path through the worker: ad page -> /api/listing */
{
  const url = 'https://www.ss.com/msg/ru/transport/cars/volkswagen/golf-7/aaaaaa.html';
  pages[url] = { status: 200, body: ssAd() };
  let j = await api('/api/listing?url=' + encodeURIComponent(url));
  check(j.ok === true && j.parser === 'ss' && j.listing.asking_price === 11900 && j.listing.make === 'Volkswagen' && j.listing.fuel === 'diesel', '/api/listing: an ss.com ad is read, the answer says which reader was used', { ok: j.ok, parser: j.parser, err: j.error });
  check(Array.isArray(j.images) && j.images.includes('https://i.ss.com/gallery/6/1/1/61600001.800.jpg'), '/api/listing: the photos of the ad are returned in full size', j.images);
  pages[url] = { status: 404, body: '' };
  j = await api('/api/listing?url=' + encodeURIComponent(url));
  check(j.ok === false && j.error === 'not_found', '/api/listing: a 404 is "not found"', j);
  pages[url] = { status: 200, body: '<html><head><title>SS.COM</title></head><body><div id="msg_div_msg">Объявление удалено или срок его размещения истёк.</div></body></html>' };
  j = await api('/api/listing?url=' + encodeURIComponent(url));
  check(j.ok === false && j.error === 'not_found' && j.removed === true, '/api/listing: an expired ad page is "removed"', j);
  pages[url] = { status: 403, body: 'denied' };
  j = await api('/api/listing?url=' + encodeURIComponent(url));
  check(j.ok === false && j.error === 'blocked', '/api/listing: a refusal by the site is "blocked", not "not found"', j);
  j = await api('/api/listing?url=' + encodeURIComponent('https://evil.example.com/a'));
  check(j.ok === false && j.error === 'bad_url', '/api/listing: a link to another site is refused', j);
  j = await api('/api/listing');
  check(j.ok === false && j.error === 'bad_url', '/api/listing: no link at all is refused', j);
}

/* =====================================================================================================================
   4. similar cars through the worker: which address is asked for
   ===================================================================================================================== */
{
  const ask = async (qs) => { calls.length = 0; const j = await api('/api/comps?' + qs); return { j, urls: calls.slice() }; };
  const fill = (u) => { pages[u] = { status: 200, body: `<html><table>${ssList}</table></html>` }; };
  let u = 'https://www.ss.com/ru/transport/cars/volkswagen/golf/'; fill(u);
  let r = await ask('source=ss&make=Volkswagen&model=Golf&year=2016');
  check(r.j.ok === true && r.j.region === 'LV' && r.j.items.length === 5 && r.urls[0] === u, 'similar cars (ss.com): Volkswagen Golf -> its category page; the 5 usable rows come back with region LV', { ok: r.j.ok, n: (r.j.items || []).length, first: r.urls[0] });
  check(r.urls.includes(u + 'page2.html') && r.urls.length <= 6, 'similar cars (ss.com): the first 5 pages of the category are asked for, no more', r.urls);
  const cases = [['make=Toyota&model=RAV4', 'https://www.ss.com/ru/transport/cars/toyota/rav-4/'], ['make=BMW&model=520d', 'https://www.ss.com/ru/transport/cars/bmw/520/'], ['make=Mercedes-Benz&model=E%20220', 'https://www.ss.com/ru/transport/cars/mercedes/e220/'],
    ['make=Škoda&model=Octavia', 'https://www.ss.com/ru/transport/cars/skoda/octavia/'], ['make=Mazda&model=6', 'https://www.ss.com/ru/transport/cars/mazda/mazda6/'], ['make=Volvo&model=XC40', 'https://www.ss.com/ru/transport/cars/volvo/xc-40/'], ['make=VW&model=Passat', 'https://www.ss.com/ru/transport/cars/volkswagen/passat/']];
  const bad = [];
  for (const [qs, want] of cases) { fill(want); const x = await ask('source=ss&year=2016&' + qs); if (x.urls[0] !== want) bad.push({ qs, want, got: x.urls[0] }); }
  check(!bad.length, `similar cars (ss.com): model names the way ss.com spells them (${cases.length} cases: rav-4, 520, e220, mazda6, xc-40 ...)`, bad);
  r = await ask('source=ss&model=Golf');
  check(r.j.ok === false && r.j.error === 'need_model' && !r.urls.length, 'similar cars: no make is refused and nothing is fetched', r.j);
  r = await ask('source=nosuch&make=Audi&model=A6');
  check(r.j.ok === false && r.j.error === 'bad_source', 'similar cars: an unknown source is refused', r.j);
  pages['https://www.ss.com/ru/transport/cars/volkswagen/golf/'] = { status: 403, body: 'denied' };
  r = await ask('source=ss&make=Volkswagen&model=Golf&year=2016');
  check(r.j.ok === false && r.j.error === 'blocked' && /ss\.com/.test(r.j.searchUrl), 'similar cars (ss.com): a refusal by the site is reported as "blocked" with the link to open by hand', r.j);
}

/* ss.com, only the requested years (the car finder asks with yfilter=1): the years are POSTed to <category>/filter/, ss.com answers with a
   cookie, and the filtered pages are read with that cookie. Every doubt falls back to the plain category pages. The fake site below keeps the
   filter behind the cookie exactly like the real one (the page addresses carry no parameters). */
{
  const BASE = 'https://www.ss.com/ru/transport/cars/audi/a6/';
  const COOKIE = 'SSID=abc123';
  const rowsFor = (k, years) => years.map((y, i) => ssRow(56000000 + k * 10 + i, { slug: 'y' + k + i, title: 'Audi A6 ' + y, model: 'A6', year: y, eng: '2.0D', km: '150 тыс.', price: (15000 + k * 1000 + i * 100) + '  €' })).join('\n');
  const html = (k, years, last) => `<html><table>${rowsFor(k, years)}</table><div><a rel="prev" href="/ru/transport/cars/audi/a6/filter/page${last}.html">prev</a> <a href="/ru/transport/cars/audi/a6/filter/page2.html">2</a></div></html>`;
  const resp = (status, body, extra = {}) => ({ status, headers: { get: (n) => extra[n.toLowerCase()] ?? null, getSetCookie: () => extra.cookies || [] }, text: async () => body });
  const seen = [];
  const S = { applied: true, postStatus: 200, last: 3, cookieOnGet: true };
  const realFetch = ctx.fetch;
  /* like the real site: a POST without the session cookie is answered with a redirect to the plain category; with it, a redirect to .../filter/ */
  ctx.fetch = async (url, init = {}) => {
    const method = init.method || 'GET', ck = (init.headers || {}).cookie;
    seen.push(`${method} ${url}${init.body ? ' ' + init.body : ''}${ck ? ' [' + ck + ']' : ''}`);
    if (url === BASE && init.redirect === 'manual') return resp(200, '<html>plain</html>', S.cookieOnGet ? { cookies: [COOKIE + '; path=/; HttpOnly'] } : {});
    if (url === BASE + 'filter/' && method === 'POST') {
      if (S.postStatus !== 200) return resp(S.postStatus, 'denied');
      return ck === COOKIE ? resp(302, '', { location: '/ru/transport/cars/audi/a6/filter/' }) : resp(302, '', { location: '/ru/transport/cars/audi/a6/', cookies: [COOKIE + '; path=/; HttpOnly'] });
    }
    if (url === BASE + 'filter/') return resp(200, html(1, ck === COOKIE && S.applied ? [2018, 2019, 2020] : [2004, 2006, 2011], S.last));
    const m = url.match(/^https:\/\/www\.ss\.com\/ru\/transport\/cars\/audi\/a6\/filter\/page(\d+)\.html$/);
    if (m) return resp(200, html(+m[1], ck === COOKIE && S.applied ? [2018, 2019, 2020] : [2003, 2004, 2005], S.last));
    return realFetch(url, init);
  };
  const ask = async (qs) => { seen.length = 0; const j = await api('/api/comps?' + qs); return { j, calls: seen.slice() }; };
  const years = (j) => [...new Set((j.items || []).map(i => i.year))].sort();
  pages[BASE] = { status: 200, body: `<html><table>${ssList}</table></html>` };

  let r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.ok === true && r.j.yearsOnly === true && r.j.items.length === 9 && years(r.j).join() === '2018,2019,2020', 'ss.com, requested years: the filtered pages come back (3 pages x 3 ads), only the requested years', { ok: r.j.ok, only: r.j.yearsOnly, n: (r.j.items || []).length, years: years(r.j) });
  check(r.calls[0] === 'GET ' + BASE && /^POST .*audi\/a6\/filter\/ topt%5B18%5D%5Bmin%5D=2018&topt%5B18%5D%5Bmax%5D=2021 \[SSID=abc123\]$/.test(r.calls[1]), 'ss.com, requested years: the category is opened first (that gives the session cookie), then the years are POSTed with that cookie as the site\'s own filter fields (topt[18][min] / [max])', r.calls.slice(0, 2));
  check(r.calls.length === 5 && r.calls[2] === 'GET ' + BASE + 'filter/ [' + COOKIE + ']' && r.calls[3] === 'GET ' + BASE + 'filter/page2.html [' + COOKIE + ']' && r.calls[4] === 'GET ' + BASE + 'filter/page3.html [' + COOKIE + ']', 'ss.com, requested years: the redirect to the filter page is followed with the cookie, pages 2 and 3 are read with it too, 5 requests in all', r.calls);
  S.last = 40; r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.yearsOnly === true && r.calls.filter(c => /filter\/page\d+\.html/.test(c)).length === 7, 'ss.com, requested years: at most 8 pages (the first plus 7), however long the list is', r.calls.length); S.last = 3;
  r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021');
  check(!r.calls.some(c => c.startsWith('POST')) && r.calls[0] === 'GET ' + BASE && r.j.yearsOnly === false, 'ss.com, without yfilter (the check of one ad, alerts): nothing changes, the plain category pages are read', r.calls);
  S.applied = false; r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.ok === true && r.j.yearsOnly === false && r.calls.includes('GET ' + BASE), 'ss.com, requested years: if the answer is not filtered (other years come back), it is not trusted and the plain category pages are read', { only: r.j.yearsOnly, calls: r.calls });
  S.applied = true; S.postStatus = 403; r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.ok === true && r.j.yearsOnly === false && r.calls.includes('GET ' + BASE), 'ss.com, requested years: if the filter is refused, the plain category pages are read', { only: r.j.yearsOnly, calls: r.calls });
  S.postStatus = 200; S.cookieOnGet = false; r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.yearsOnly === true && r.calls.filter(c => c.startsWith('POST')).length === 2 && /\[SSID=abc123\]$/.test(r.calls.filter(c => c.startsWith('POST'))[1]), 'ss.com, requested years: if the category gave no cookie, the first post gets one, and the post is repeated once with it', r.calls);
  S.cookieOnGet = true; S.applied = false; r = await ask('source=ss&make=Audi&model=A6&yfrom=2018&yto=2021&yfilter=1');
  check(r.j.yearsOnly === false && /filter not applied/.test(r.j.yearsWhy || ''), 'ss.com, requested years: when the filter does not work, the answer says why (yearsWhy), so a short list can be explained', r.j.yearsWhy); S.applied = true;
  S.postStatus = 200; r = await ask('source=ss&make=Audi&model=A6&yfrom=2021&yto=2018&yfilter=1');
  check(!r.calls.some(c => c.startsWith('POST')), 'ss.com, requested years: years the wrong way round or missing never reach the filter', r.calls);
  ctx.fetch = realFetch;
}

/* =====================================================================================================================
   5. AutoScout24: list (cards and the JSON fallback) and ad page
   ===================================================================================================================== */
const AS = 'https://www.autoscout24.com/lst/';
const asCard = (guid, o) => `<article class="cldt-summary-full-item" data-guid="${guid}" data-price="${o.price}"${o.km != null ? ` data-mileage="${o.km}"` : ''}${o.reg != null ? ` data-first-registration="${o.reg}"` : ''}${o.fuel ? ` data-fuel-type="${o.fuel}"` : ''} data-make="${o.make || 'volkswagen'}" data-model="${o.model || 'golf'}">` +
  `<a href="/offers/${guid}"><img src="${o.img || 'https://prod.pictures.autoscout24.net/listing-images/' + guid + '/250x188.webp'}"></a><h2>${o.title}</h2></article>`;
{
  const html = '<html><body>' + [asCard('11111111-aaaa-bbbb-cccc-000000000001', { price: 15990, km: 98000, reg: '06-2018', fuel: 'd', title: 'Volkswagen Golf 2.0 TDI DSG Highline' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000002', { price: 12500, km: 120000, reg: '03-2017', fuel: 'b', title: 'Volkswagen Golf 1.4 TSI' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000003', { price: 29990, km: 15000, reg: '01-2022', fuel: 'E', title: 'Volkswagen ID.3' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000004', { price: 9900, reg: 'new', title: 'Volkswagen Golf 1.0 TSI' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000005', { price: 150, km: 1000, reg: '01-2015', fuel: 'b', title: 'Golf spare parts' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000006', { price: 8800, km: 200000, reg: '02-2013', fuel: 'l', title: 'Volkswagen Golf 1.6 LPG' }),
    asCard('11111111-aaaa-bbbb-cccc-000000000007', { price: 7000, km: 170000, reg: '05-2012', fuel: '', title: 'Golf' })].join('\n') + '</body></html>';
  const it = run('parseAs24List', html, AS);
  check(it.length === 6, 'AutoScout24 list: 6 of 7 cards (the 150 € card is dropped)', it.length);
  const [a, b, c, d, f, g] = it;
  check(a.price === 15990 && a.km === 98000 && a.year === 2018 && a.fuel === 'diesel' && a.url === 'https://www.autoscout24.com/offers/11111111-aaaa-bbbb-cccc-000000000001', 'AutoScout24 list: price, mileage, year from "06-2018", fuel letter d, link built from the card id', a);
  check(a.title === 'Volkswagen Golf 2.0 TDI DSG Highline' && a.img === 'https://prod.pictures.autoscout24.net/listing-images/11111111-aaaa-bbbb-cccc-000000000001/250x188.webp', 'AutoScout24 list: the title is the card heading, the photo is the card picture', { t: a.title, i: a.img });
  check(b.fuel === 'petrol' && c.fuel === 'electric' && f.fuel === 'lpg' && g.fuel === null, 'AutoScout24 list: fuel letters b, E (any case), l, and an empty one', [b.fuel, c.fuel, f.fuel, g.fuel]);
  check(d.km === null && d.year === null, 'AutoScout24 list: a card with no mileage and "new" as registration has no mileage and no year (not 0)', d);
  const fb = '<html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { listings: [
    { id: 'a1', url: '/offers/aaa-111', price: { priceFormatted: '€ 12,990' }, tracking: { price: '12990', mileage: '85000', firstRegistration: '05/2019' }, vehicle: { make: 'Audi', model: 'A3', modelVersionInput: 'Sportback 1.5 TFSI' }, vehicleDetails: [{ iconName: 'gas_pump', data: 'Petrol' }] },
    { id: 'a2', url: '/offers/bbb-222', price: { priceFormatted: '€ 21,500' }, tracking: { price: '21500', mileage: '40000', firstRegistration: '11/2021' }, vehicle: { make: 'Audi', model: 'A3', modelVersionInput: '35 TDI' }, vehicleDetails: [{ iconName: 'gas_pump', data: 'Diesel' }] }] } } }) + '</script></html>';
  const nd = run('parseAs24List', fb, AS);
  check(nd.length === 2 && nd[0].price === 12990 && nd[0].km === 85000 && nd[0].year === 2019 && nd[0].url === 'https://www.autoscout24.com/offers/aaa-111' && nd[0].title === 'Audi A3 Sportback 1.5 TFSI' && nd[0].fuel === 'petrol' && nd[1].fuel === 'diesel', 'AutoScout24 list: when there are no cards, the listings are read from the page JSON (price, mileage, year, link, title, fuel)', nd);
  check(run('parseAs24List', '<html><body>nothing</body></html>', AS).length === 0, 'AutoScout24 list: a page with nothing gives an empty list');
}
const as24Page = (v = {}) => '<html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { listingDetails: {
  vehicle: Object.assign({ make: 'Volkswagen', model: 'Golf', modelGroup: 'Golf', modelVersionInput: '2.0 TDI DSG Highline', fuelCategory: { raw: 'D', formatted: 'Diesel' }, primaryFuel: { formatted: 'Diesel' }, transmissionType: 'Automatic', rawDisplacementInCCM: 1968, rawPowerInKw: 110, driveTrain: { formatted: 'Front' }, bodyType: 'Estate', mileageInKmRaw: 121000, firstRegistrationDateRaw: '2019-03-01', hadAccident: false, noOfPreviousOwners: 2 }, v),
  prices: { public: { priceRaw: 21990 } }, location: { zip: '10115', city: 'Berlin', countryCode: 'DE', street: 'Musterstr. 1', latitude: 52.532101, longitude: 13.384899 },
  seller: { isDealer: true, companyName: 'Autohaus Test GmbH' }, images: ['https://prod.pictures.autoscout24.net/listing-images/x/250x188.webp', 'https://prod.pictures.autoscout24.net/listing-images/y/250x188.webp'],
  description: '<ul><li>Scheckheft</li><li>Winterreifen</li></ul>', createdTimestampWithOffset: '2026-09-28T10:11:12+02:00' } } } }) + '</script></html>';
{
  const r = run('parseAs24Listing', as24Page(), 'https://www.autoscout24.de/angebote/x-1'), l = r.listing;
  check(l.make === 'Volkswagen' && l.model === 'Golf' && l.year === 2019 && l.mileage_km === 121000 && l.asking_price === 21990, 'AutoScout24 ad: make, model, year, mileage and price', l);
  check(l.fuel === 'diesel' && l.lpg === false && l.gearbox === 'automatic' && l.engine_l === 2 && l.power_kw === 110 && l.drive === 'fwd' && l.body === 'Estate', 'AutoScout24 ad: diesel, automatic, 1968 cm³ is 2.0 l, 110 kW, front drive, body', l);
  check(l.dealer === true && l.seller_name === 'Autohaus Test GmbH' && l.accident === false && l.owners === 2 && l.posted === '2026-09-28', 'AutoScout24 ad: dealer, seller name, accident-free, owners, publication date', l);
  check(l.place === '10115 Berlin, DE' && l.geo.lat === 52.5321 && l.geo.lon === 13.3849 && /Scheckheft/.test(l.description), 'AutoScout24 ad: place, rounded map position, description without markup', { place: l.place, geo: l.geo, d: l.description });
  check(r.images.length === 2 && /\/720x540\.webp$/.test(r.images[0]) && r.image === r.images[0], 'AutoScout24 ad: photos are asked for in the large size', r.images);
  const f = (v) => run('parseAs24Listing', as24Page(v), 'https://www.autoscout24.de/angebote/x-1').listing;
  const hy = f({ fuelCategory: { raw: '2', formatted: 'Electric/Gasoline' }, primaryFuel: { formatted: 'Electric/Gasoline' } }), lpg = f({ fuelCategory: { raw: 'L', formatted: 'LPG' }, primaryFuel: { formatted: 'LPG' } }), el = f({ fuelCategory: { raw: 'E', formatted: 'Electric' }, primaryFuel: { formatted: 'Electric' }, rawDisplacementInCCM: 0 });
  check(hy.fuel === 'hybrid' && lpg.fuel === 'petrol' && lpg.lpg === true && el.fuel === 'electric' && el.engine_l === null, 'AutoScout24 ad: a hybrid, an LPG car (petrol with a gas installation) and an electric car (no engine size)', [hy.fuel, lpg.fuel, lpg.lpg, el.fuel, el.engine_l]);
  const bmw = f({ make: 'BMW', model: '520', modelGroup: '5er', modelVersionInput: 'd Touring' });
  check(bmw.make === 'BMW' && bmw.model === '520', 'AutoScout24 ad: the model line "5er" gives way to the exact model (520)', { make: bmw.make, model: bmw.model });
  check(run('parseAs24Listing', '<html><body>nothing</body></html>', 'https://www.autoscout24.de/angebote/x-1') === null, 'AutoScout24 ad: a page without the data gives null, so the generic reader takes over');
}
{
  const ask = async (qs, md = 'golf') => { calls.length = 0; pages['https://www.autoscout24.com/lst/volkswagen/' + md + '?x'] = null; const j = await api('/api/comps?' + qs); return { j, urls: calls.slice() }; };
  const r = await ask('source=as24&cy=D&make=Volkswagen&model=Golf&year=2018&fuel=diesel');
  const want = 'https://www.autoscout24.com/lst/volkswagen/golf?atype=C&cy=D&damaged_listing=exclude&desc=0&fuel=D&fregfrom=2017&fregto=2019&sort=standard&ustate=N%2CU&page=1';
  check(r.urls[0] === want && r.urls.length === 3, 'AutoScout24 search address: Germany, diesel, registered 2017–2019, damaged cars excluded, 3 pages', r.urls);
  const mb = await ask('source=as24&cy=NL&make=Mercedes-Benz&model=E%20350&year=2016');
  check(/\/lst\/mercedes-benz\/e-350\?atype=C&cy=NL&/.test(mb.urls[0]), 'AutoScout24 search address: Mercedes "E 350" is "e-350", the country is NL', mb.urls[0]);
  const bad = await ask('source=as24&cy=XX&make=Audi&model=A6');
  check(bad.j.ok === false && bad.j.error === 'bad_source' && !bad.urls.length, 'AutoScout24: an unknown country is refused and nothing is fetched', bad.j);
}

/* =====================================================================================================================
   6. autoplius.lt and autoportaal.ee
   ===================================================================================================================== */
{
  const card = (id, price, head, params, o = {}) => `<a href="https://en.autoplius.lt/ads/volkswagen-golf-${id}.html" class="announcement-item announcement-item-regular"><div class="announcement-media"><img data-src="${o.img ?? 'https://autoplius-img.dgn.lt/ann_' + id + '/photo.jpg'}"></div>` +
    `<div class="announcement-body"><div class="announcement-title">Volkswagen Golf</div><div class="announcement-title-parameters">${head}</div></div><div class="announcement-pricing-info"><strong> ${price} &euro;</strong></div>` +
    `<div class="announcement-parameters"><div class="announcement-parameters-block">${params}</div></div></a>`;
  const sp = (...xs) => '<div>' + xs.map(x => `<span>${x}</span>`).join('') + '</div>';
  const html = '<html>' + card(12345678, '8&nbsp;990', sp('2015-03'), sp('187&nbsp;000 km', 'Diesel', 'Automatic', '1.6 l.')) + card(12345679, '7\u00a0500', sp('2014-11', 'Highline'), sp('210 000 km', 'Petrol', 'Manual', '1.4 l.')) + card(12345680, '150', sp('2016'), sp('100 000 km', 'Petrol')) + '</html>';
  const it = run('parseAutopliusList', html, 'https://en.autoplius.lt/ads/used-cars/volkswagen/golf');
  check(it.length === 2, 'autoplius list: 2 of 3 cards (the 150 € card is dropped)', it.length);
  check(it.length > 0 && it[0].price === 8990 && it[0].year === 2015 && it[0].km === 187000 && it[0].fuel === 'diesel' && it[0].gear === 'automatic' && it[0].url === 'https://en.autoplius.lt/ads/volkswagen-golf-12345678.html', 'autoplius list: price with non-breaking space, year from "2015-03", mileage, fuel, gearbox, link', it[0]);
  check(it.length > 1 && it[0].title === 'Volkswagen Golf 1.6 l.' && it[1].title === 'Volkswagen Golf Highline 1.4 l.' && it[1].gear === 'manual' && it[1].fuel === 'petrol', 'autoplius list: the title is the name, the version and the engine size', [it[0]?.title, it[1]?.title]);
  check(it.length > 0 && it[0].img === 'https://autoplius-img.dgn.lt/ann_12345678/photo.jpg', 'autoplius list: the photo', it[0]?.img);
}
{
  const prod = (id, o = {}) => ({ '@type': 'Product', name: 'Volkswagen Golf', description: `Müüa auto ${o.name || 'Golf Variant 2.0 TDI'}, ${o.year || 2019}, läbisõit 121000 km`, brand: { name: 'Volkswagen' }, model: 'Golf', vehicleModelDate: String(o.year || 2019), fuelType: o.fuel || 'Diisel', vehicleTransmission: o.gear || 'Automaat (auto)',
    mileageFromOdometer: { value: String(o.km ?? 121000) }, vehicleEngine: { engineDisplacement: { value: '2.0' }, enginePower: { value: '110' } }, vehicleIdentificationNumber: o.vin ?? 'WVWZZZAUZKW123456', driveWheelConfiguration: 'Eesvedu', color: 'Hall', bodyType: 'Universaal', image: ['https://autoportaal.ee/img/' + id + '.jpg'],
    offers: { '@type': 'Offer', price: String(o.price ?? 21990), url: 'https://autoportaal.ee/et/kasutatud-autod/' + id } });
  const ld = (arr) => `<script type="application/ld+json">${JSON.stringify(arr)}</script>`;
  const list = '<html>' + ld([prod(100001), prod(100002, { price: 19500, fuel: 'Bensiin', gear: 'Manuaal', name: 'Golf 1.4 TSI', year: 2017, km: 90000 }), prod(100003, { price: 150 })]) + '<img id="aimg100001" class="thumb" src="https://autoportaal.ee/thumb/100001.jpg"></html>';
  const it = run('parseApList', list);
  check(it.length === 2 && it[0].price === 21990 && it[0].year === 2019 && it[0].km === 121000 && it[0].fuel === 'diesel' && it[0].gear === 'automatic' && it[0].engine_l === 2 && it[0].power_kw === 110, 'autoportaal list: price, year, mileage, diesel, automatic, 2.0 l, 110 kW (the 150 € product is dropped)', it[0]);
  check(it[1].fuel === 'petrol' && it[1].gear === 'manual' && it[1].km === 90000 && it[1].title.indexOf('Golf 1.4 TSI') === 0, 'autoportaal list: a petrol manual car; the title is taken from the description', it[1]);
  check(it[0].img === 'https://autoportaal.ee/thumb/100001.jpg' && it[0].url === 'https://autoportaal.ee/et/kasutatud-autod/100001' && it[0].vin === 'WVWZZZAUZKW123456', 'autoportaal list: the thumbnail by id, the link, the VIN', it[0]);
  const page = '<html>' + ld(prod(100001)) + '<div class="location">Tallinn</div><p>Müüja: Auto Test AS Tallinn, Eesti</p><h3>Lisainfo</h3><p>Talverehvid kaasas</p></html>';
  const r = run('parseApListing', page, 'https://autoportaal.ee/et/kasutatud-autod/100001'), l = r.listing;
  check(l.make === 'Volkswagen' && l.model === 'Golf' && l.year === 2019 && l.mileage_km === 121000 && l.asking_price === 21990 && l.fuel === 'diesel' && l.gearbox === 'automatic' && l.vin === 'WVWZZZAUZKW123456', 'autoportaal ad: the main fields from the page data', l);
  check(l.place === 'Tallinn' && l.dealer === true && l.seller_name === 'Auto Test AS' && /Talverehvid/.test(l.description), 'autoportaal ad: place, a dealer (AS), the extra information', { place: l.place, dealer: l.dealer, seller: l.seller_name });
  const oue = run('parseApListing', page.replace('Auto Test AS Tallinn', 'Auto Test OÜ Tallinn'), 'https://autoportaal.ee/et/kasutatud-autod/100001').listing;
  check(oue.dealer === true && oue.seller_name === 'Auto Test OÜ', 'autoportaal ad: a seller named "OÜ" (the usual Estonian company form) is a dealer', { dealer: oue.dealer, seller: oue.seller_name });
  const priv = run('parseApListing', page.replace('Müüja: Auto Test AS Tallinn, Eesti', 'Müüja: Jaan Tamm Tallinn, Eesti'), 'https://autoportaal.ee/et/kasutatud-autod/100001').listing;
  check(priv.dealer === false, 'autoportaal ad: a private seller is not a dealer', priv.dealer);
  check(run('parseApListing', '<html>no data</html>', 'https://autoportaal.ee/et/kasutatud-autod/1') === null, 'autoportaal ad: a page without product data gives null');
}

/* =====================================================================================================================
   7. the generic reader (any other site)
   ===================================================================================================================== */
{
  const car = { '@type': 'Car', name: 'BMW 520d xDrive Touring', brand: { name: 'BMW' }, model: '520d', offers: { price: '18900' }, mileageFromOdometer: { value: '152000' }, vehicleModelDate: '2017', fuelType: 'Diesel', vehicleTransmission: 'Automatic', vehicleIdentificationNumber: 'WBAJA51000G123456', color: 'Black', bodyType: 'Estate', image: 'https://example.com/a.jpg' };
  const html = `<html><head><title>BMW 520d xDrive Touring | Example</title><meta property="og:image" content="https://example.com/cover.jpg"><meta property="og:description" content="BMW 520d, 2017, 152 000 km, 18 900 €"><script type="application/ld+json">${JSON.stringify(car)}</script></head><body></body></html>`;
  const r = run('parseGenericListing', html, 'https://example.com/cars/1'), l = r.listing;
  check(l.asking_price === 18900 && l.mileage_km === 152000 && l.year === 2017 && l.make === 'BMW' && l.model === '520d' && l.fuel === 'diesel' && l.gearbox === 'automatic' && l.vin === 'WBAJA51000G123456' && l.color === 'Black', 'generic reader: a page with schema.org Car data', l);
  check(r.image === 'https://example.com/cover.jpg', 'generic reader: the page photo (og:image) is preferred', r.image);
  const t = run('parseGenericListing', '<html><head><title>Audi A4 2.0 TDI, 2016</title></head><body><p>Audi A4 2.0 TDI, 2016. Mileage: 145 000 km. Price 12 500 €. Automatic.</p></body></html>', 'https://example.com/cars/2').listing;
  check(t.make === 'Audi' && t.model === 'A4' && t.year === 2016 && t.asking_price === 12500 && t.mileage_km === 145000 && t.fuel === 'diesel' && t.gearbox === 'automatic', 'generic reader: a plain text page (make and model from the title, the rest from the text)', t);
  const e = run('parseGenericListing', '<html><body>hello</body></html>', 'https://example.com/cars/3').listing;
  check(e.asking_price === null && e.make === null, 'generic reader: a page with nothing gives empty fields, not made-up ones', e);
}

/* =====================================================================================================================
   8. /api/import: a page the user opened in their own browser (autoplius, autogidas, auto24 refuse servers)
   ===================================================================================================================== */
{
  const post = async (body, raw) => { ctx.__b = raw ?? JSON.stringify(body); return JSON.parse(await W(`__worker.fetch(new Request('https://carscout.test/api/import', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: __b }), env, { waitUntil() {} }).then(function (r) { return r.text(); })`)); };
  const card = (id, price, year, km) => `<a href="https://en.autoplius.lt/ads/volkswagen-golf-${id}.html" class="announcement-item announcement-item-regular"><div class="announcement-body"><div class="announcement-title">Volkswagen Golf</div><div class="announcement-title-parameters"><div><span>${year}-03</span></div></div></div><div class="announcement-pricing-info"><strong> ${price} &euro;</strong></div><div class="announcement-parameters"><div class="announcement-parameters-block"><div><span>${km} km</span><span>Diesel</span><span>Automatic</span><span>2.0 l.</span></div></div></div></a>`;
  const listHtml = '<html><body>' + [1, 2, 3, 4].map(k => card(20000000 + k, (9000 + k * 300) + '', 2017, 150000 + k * 5000)).join('') + '</body></html>';
  const n0 = calls.length;
  let r = await post({ url: 'https://en.autoplius.lt/ads/used-cars/volkswagen/golf', html: listHtml });
  check(r.ok && r.kind === 'list' && r.region === 'LT' && r.items.length === 4 && r.items[0].price === 9300 && r.items[0].year === 2017 && r.items[0].km === 155000 && r.source === 'autoplius.lt', 'import: an autoplius search page the user opened gives its ads (Lithuania)', r);
  check(calls.length === n0, 'import: nothing is fetched from the site (the page came from the user)', calls.length - n0);
  const agCard = (id, price) => `<article class="list-item-new" data-price="${price}"><a href="/skelbimas/volkswagen-golf-${id}.html"><h2 class="item-title">Volkswagen Golf</h2></a><span class="parameter-value">2017 m.</span><span class="parameter-value">Dyzelinas</span><span class="parameter-value">160 000 km</span><span class="parameter-value">Automatinė</span><span class="parameter-value">2.0 L / 110 kW</span></article>`;
  r = await post({ url: 'https://autogidas.lt/skelbimai/automobiliai/volkswagen/golf/', html: '<html>' + [1, 2, 3].map(k => agCard(k, 9500 + k * 100)).join('') + '</html>' });
  check(r.ok && r.kind === 'list' && r.items.length === 3 && r.items[0].url === 'https://autogidas.lt/skelbimas/volkswagen-golf-1.html' && r.items[0].fuel === 'diesel' && r.items[0].engine_l === 2, 'import: an autogidas search page gives its ads', r.items && r.items[0]);
  const a24Row = (id, price) => `<div class="result-row"><a href="/naudoti/${id}" class="main">Volkswagen Golf</a><span class="price">${price} €</span><div class="extra"><span class="year">2017</span><span class="mileage">160 000 km</span><span class="fuel">Dyzelinas</span><span class="transmission">Automatinė</span></div></div>`;
  r = await post({ url: 'https://www.auto24.lt/naudoti/nimekiri.php?b=4', html: '<html>' + [11, 12, 13].map(k => a24Row(k, 9800)).join('') + '</html>' });
  check(r.ok && r.kind === 'list' && r.region === 'LT' && r.items.length === 3 && r.items[0].url === 'https://www.auto24.lt/naudoti/11', 'import: an auto24.lt list keeps the links on auto24.lt (not auto24.ee)', r.items && r.items[0]);
  const ad = `<html><head><title>Volkswagen Golf 2.0 TDI, 2017</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Car', name: 'Volkswagen Golf 2.0 TDI', brand: { name: 'Volkswagen' }, model: 'Golf', offers: { price: '10900' }, mileageFromOdometer: { value: '158000' }, vehicleModelDate: '2017', fuelType: 'Diesel', vehicleTransmission: 'Automatic' })}</script></head><body><p>Volkswagen Golf 2.0 TDI, 2017, 158 000 km, 10 900 €. ` + 'x'.repeat(300) + '</p></body></html>';
  r = await post({ url: 'https://en.autoplius.lt/ads/volkswagen-golf-2-0-l-hatchback-2017-diesel-29000001.html', html: ad });
  check(r.ok && r.kind === 'ad' && r.listing.asking_price === 10900 && r.listing.mileage_km === 158000 && r.listing.year === 2017 && r.listing.make === 'Volkswagen' && r.region === 'LT', 'import: one autoplius ad the user opened is read like a link (make, year, mileage, price)', r.listing);
  for (const [what, body, raw] of [['a site that is not supported', { url: 'https://evil.example/x', html: listHtml }], ['no page', { url: 'https://en.autoplius.lt/ads/x.html', html: '' }], ['not JSON', null, 'hello'], ['a page that is too big', { url: 'https://en.autoplius.lt/ads/x.html', html: 'x'.repeat(6000001) }]]) {
    const x = await post(body, raw); check(x.ok === false && /bad_request|too_big/.test(x.error), 'import: refused: ' + what, x.error);
  }
  r = await post({ url: 'https://en.autoplius.lt/ads/x.html', html: '<html><body>' + 'nothing here '.repeat(40) + '</body></html>' });
  check(r.ok === false && r.error === 'parse_failed', 'import: a page with no ads and no car gives "parse_failed", not made-up data', r);
  check(W("rlKind('POST', '/api/import')") === 'write', 'import: counted against the write budget of the request limits', W("rlKind('POST', '/api/import')"));
}

/* =====================================================================================================================
   9. autouncle.de (Germany, an aggregator; refuses servers, so only through the bookmark). Built from what a real results page and
      ad page of 29 Oct 2026 look like: hashed class names, an <article> per car, a facts list, the first price before the labels of
      AutoUncle's own verdict, a FAQ <article> at the end, new cars ("Neu (2026)") between the used ones, JSON-LD Product/Vehicle on the ad page.
   ===================================================================================================================== */
{
  const li = (t) => `<li class="_vh91Z9 _AcHqqh">${t}</li>`;
  const card = ({ id, head, facts, prices = [], labels = true }) => `<article class="_3faffL"><div class="_VitZgD"><div class="_hWIIhC"><button class="_Wy1GIS"><div class="_ZylZec"><img alt="Gebraucht BMW M3" loading="lazy" class="_Wjcaj6" src="https://images.autouncle.com/de/car_images/medium_${id}.webp"></div></button></div>` +
    `<a class="_9Da-uE" href="/de/d/${id}-gebraucht-2022-bmw-m3-competition" title="Details für ${head} anzeigen"><div class="_9Da-uE"><div class="_ES-bDr"><h3 class="_jNrUl_ _rUPjzn" data-weight="bold">${head}</h3><p class="_jNrUl_">Competition M SPORT+HuD+H/K+DA</p></div><ul class="_EKB7Vb">${facts.map(li).join('')}<li><span class="_AOGLZW">Details<div class="_iEAJDY"><svg/></div></span></li></ul></div></a>` +
    `<div class="_3I41Lu"><div class="_2GbTvp"><img src="https://fe-assets.autouncle.com/images/logos/au-badge.webp" alt="autouncle-certified"><div class="_nj1TZA"><p class="_c5X7pp">Guter Preis</p></div></div>${prices.map((p, k) => `<div class="${k ? '_QYH9ni' : '_hPeORc'}">${p}&nbsp;€</div>`).join('')}</div>` +
    (labels ? `<div class="_nJ03_m"><div class="_Y4umQW"><button class="_UqqJYF"><span class="_ke1BGv">Unter dem Marktpreis<div class="_iEAJDY"><svg/></div></span><span class="_7sUAH5">2.601&nbsp;€</span></button><button class="_UqqJYF"><span class="_ke1BGv">Preisänderung</span><span class="_7sUAH5">↓ -1%</span></button><button class="_UqqJYF"><span class="_ke1BGv">Tage inseriert</span><span>17</span></button></div></div>` : '') +
    `</div><div class="_1dR5Q9"><div class="_0an15T">Procar Automobile</div><div>48163 Münster, Nordrhein-Westfalen</div><a class="_n41Km1" href="/de/das_wiedersehen/procar-automobile-de/${id}/421200763" target="_blank">Zum Angebot</a></div></article>`;
  const m3 = (id, price, year, km, extra = {}) => card({ id, head: `Gebraucht (${year}) BMW M3 Competition Edition 510 PS | Guter Preis`, facts: [`Jul ${year}`, `${km} km`, '<span>Ausstattungslinie<!-- -->:&nbsp;</span>Competition Edition', '3.0L Benzin', 'Limousine', 'Automatik', '510 PS (375 kW)', '<span>CO2-Klasse<!-- -->:&nbsp;</span>G', '224 g CO2/km komb.', '9.9 L/100Km'], prices: [price], ...extra });
  const faq = '<article class="_faq"><h3>Wie ist das Preisniveau bei BMW M3 gebraucht?</h3><ul><li>BMW M3 kombi: 861 Fahrzeuge - Durchschnittspreis €99.493</li></ul></article>';
  const page = (cards) => '<html><head><title>BMW M3 gebraucht kaufen</title></head><body>' + cards.join('') + faq + '<footer>Impressum 12.345 € km</footer></body></html>';
  const cards = [
    m3(228435247, '85.999', 2026, '13.412', {}),                                                                       // two prices: the first is the price, the second the old one
    m3(209186618, '87.850', 2025, '6.000'),
    card({ id: 210277758, head: 'Neu (2026) BMW M3 Competition Edition 510 PS | Superpreis', facts: ['Neuwagen', '20 km', '3.0L Benzin', 'Automatik'], prices: ['89.990'] }),   // a new car: left out
    card({ id: 215119075, head: 'Gebraucht (2026) BMW M3 Competition Edition 530 PS | Guter Preis', facts: ['Neuwagen', '4.000 km', '3.0L Benzin', 'Kombi', 'Automatik', '530 PS (390 kW)'], prices: ['92.730'] }),   // used, first month unknown
    card({ id: 229347368, head: 'Gebraucht (2022) BMW M3 Competition Edition 510 PS | Superpreis', facts: ['Jul 2022', '66.200 km', '3.0L Benzin', 'Limousine', 'Automatik', '510 PS (375 kW)'], prices: ['64.990'], labels: false }),   // no verdict labels at all
    card({ id: 230000001, head: 'Gebraucht (2021) Tesla Model 3 Long Range | Guter Preis', facts: ['Mär 2021', '45.000 km', 'Elektro', 'Automatik', '351 PS (258 kW)'], prices: ['29.900'] }),
    card({ id: 230000002, head: 'Gebraucht (2020) BMW 330e | Guter Preis', facts: ['Mai 2020', '70.000 km', '2.0L Benzin/Elektro', 'Automatik', '292 PS'], prices: ['27.500'] }),
    card({ id: 230000003, head: 'Gebraucht (2019) BMW 320d | Fairer Preis', facts: ['Mai 2019', '120.000 km', '2.0L Diesel', 'Schaltgetriebe', '190 PS (140 kW)'], prices: ['19.900'] }),
    card({ id: 230000004, head: 'Gebraucht (2019) BMW M2 | Preis auf Anfrage', facts: ['Mai 2019', '50.000 km', '3.0L Benzin'], prices: [] }),   // no price: left out
    m3(228435247, '85.999', 2026, '13.412')                                                                              // the same ad twice: counted once
  ];
  const html = page(cards), url = 'https://www.autouncle.de/de/gebrauchtwagen/BMW/M3';
  const it = run('parseAuList', html, url);
  check(it.length === 7, 'autouncle list: 7 of 10 cards (the new car, the card without a price and the repeated ad are dropped; the FAQ block is not a car)', it.map(x => x.url));
  const by = (id) => it.find(x => x.url.includes('/' + id + '-')) || {};
  check(by(228435247).price === 85999 && by(228435247).year === 2026 && by(228435247).km === 13412 && by(228435247).url === 'https://www.autouncle.de/de/d/228435247-gebraucht-2022-bmw-m3-competition', 'autouncle list: the first of two prices, year, mileage with a thousands dot, absolute link', by(228435247));
  check(by(228435247).fuel === 'petrol' && by(228435247).gear === 'automatic' && by(228435247).engine_l === 3 && by(228435247).power_kw === 375 && by(228435247).title === 'BMW M3 Competition Edition 510 PS', 'autouncle list: fuel, gearbox, engine, power in kW and a title without the "Gebraucht (year)" and the price verdict', by(228435247));
  check(by(229347368).price === 64990 && by(229347368).km === 66200, 'autouncle list: a card without the verdict labels still gives its price', by(229347368));
  check(by(215119075).km === 4000 && by(215119075).year === 2026 && by(215119075).power_kw === 390, 'autouncle list: a used car whose first facts say "Neuwagen" is kept (title says Gebraucht) with its mileage', by(215119075));
  check(by(230000001).fuel === 'electric' && by(230000001).power_kw === 258 && by(230000002).fuel === 'hybrid' && by(230000002).power_kw === 215 && by(230000003).fuel === 'diesel' && by(230000003).gear === 'manual', 'autouncle list: electric, hybrid (petrol/electric), diesel and manual; PS converted to kW when kW is not given', [by(230000001), by(230000002), by(230000003)]);
  check(it.every(x => x.price !== 2601 && x.price >= 300) && !it.some(x => /Neu\b/.test(x.title)), 'autouncle list: the saving ("Unter dem Marktpreis 2.601 €") is never taken for the price; no new cars', it.map(x => x.price));
  check(by(228435247).img === 'https://images.autouncle.com/de/car_images/medium_228435247.webp', 'autouncle list: the photo of the car (not the AutoUncle badge)', by(228435247).img);
  check(run('parseAuList', '<html><body>nothing</body></html>', url).length === 0 && run('parseAuList', '', url).length === 0, 'autouncle list: a page with no cards gives nothing');

  const ldAd = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'AutoUncle' }, { '@type': ['Product', 'Vehicle'], '@id': 'x#product', name: 'Gebraucht 2022 BMW M3 Competition Edition 510 PS in Grau', description: 'Gebraucht BMW M3 Competition Edition in Grau. 66.200 km, Automatik, 510 PS. Superpreis: 64.990 €.', color: 'Grau', brand: { '@type': 'Brand', name: 'BMW' }, model: 'M3', vehicleModelDate: '2022', vehicleTransmission: 'Automatik',
    image: { '@type': 'ImageObject', url: 'https://images.autouncle.com/de/car_images/9fc08f9a_2022-bmw-m3.webp' }, offers: { '@type': 'Offer', price: 64990, priceCurrency: 'EUR', availableAtOrFrom: { '@type': 'Place', address: { addressCountry: 'DE', postalCode: '58636', addressLocality: 'Iserlohn', addressRegion: 'Nordrhein-Westfalen' } } },
    bodyType: 'Limousine', fuelType: 'Benzin', vehicleEngine: { engineDisplacement: { value: 3, unitText: 'L' }, enginePower: { value: 510, unitText: 'PS', additionalProperty: { name: 'kilowatt', value: 375, unitCode: 'KWT', unitText: 'kW' } } }, mileageFromOdometer: { value: 66200, unitCode: 'KMT' } }] };
  const adHtml = '<html><head><title>Gebraucht BMW M3 Competition Edition 510 PS (2022) in Iserlohn - 64.990 € | AutoUncle</title><script type="application/ld+json">' + JSON.stringify(ldAd) + '</script></head><body>' + cards.slice(0, 4).join('') + '<p>' + 'Preisgeprüft durch AutoUncle. '.repeat(10) + '</p></body></html>';
  const adUrl = 'https://www.autouncle.de/de/d/229347368-gebraucht-2022-bmw-m3-competition-edition-510-ps';
  const ra = run('parseAuListing', adHtml, adUrl), L = ra && ra.listing || {};
  check(L.make === 'BMW' && L.model === 'M3' && L.year === 2022 && L.mileage_km === 66200 && L.asking_price === 64990 && L.fuel === 'petrol' && L.gearbox === 'automatic' && L.engine_l === 3 && L.power_kw === 375, 'autouncle ad: make, model, year, mileage, price, fuel, gearbox, engine and power from the JSON-LD', L);
  check(L.country === 'DE' && L.place === '58636 Iserlohn, DE' && L.body === 'Limousine' && L.model_raw === 'M3 Competition Edition 510 PS' && ra.image === 'https://images.autouncle.com/de/car_images/9fc08f9a_2022-bmw-m3.webp', 'autouncle ad: where the car is (Germany), body, the version text without "Gebraucht 2022" and the colour, the photo', { L, image: ra && ra.image });
  check(run('parseAuListing', '<html><body>no data</body></html>', adUrl) === null, 'autouncle ad: a page without the vehicle data gives null (the generic reader takes over)');

  const post = async (body) => { ctx.__b = JSON.stringify(body); return JSON.parse(await W(`__worker.fetch(new Request('https://carscout.test/api/import', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: __b }), env, { waitUntil() {} }).then(function (r) { return r.text(); })`)); };
  const n0 = calls.length;
  let r = await post({ url, html });
  check(r.ok && r.kind === 'list' && r.region === 'DE' && r.source === 'autouncle.de' && r.items.length === 7 && r.items[0].price === 85999, 'import: an autouncle.de results page the user opened gives its used ads (Germany)', r.ok ? { n: r.items.length, region: r.region, source: r.source } : r);
  r = await post({ url: url + '?page=2', html });
  check(r.ok && r.kind === 'list' && r.items.length === 7, 'import: a results page with ?page=2 is a list too', r.kind);
  r = await post({ url: adUrl, html: adHtml });
  check(r.ok && r.kind === 'ad' && r.parser === 'autouncle' && r.listing.asking_price === 64990 && r.listing.mileage_km === 66200 && r.listing.year === 2022 && r.listing.make === 'BMW' && r.region === 'DE', 'import: one autouncle.de ad (its page also shows similar cars) is ONE ad, read like a link', r.ok ? r.listing : r);
  check(calls.length === n0, 'import: nothing is fetched from autouncle.de (the page came from the user)', calls.length - n0);
  const ok = (u) => P(`allowed(${JSON.stringify(u)})`), img = (u) => P(`imgAllowed(${JSON.stringify(u)})`);
  check(ok('https://www.autouncle.de/de/d/1-x') && ok('https://autouncle.de/') && !ok('https://autouncle.de.evil.com/') && !ok('https://notautouncle.de/') && !ok('https://www.autouncle.com/'), 'autouncle.de is a supported site; look-alike hosts are not', ['https://autouncle.de.evil.com/', 'https://notautouncle.de/'].map(ok));
  check(img('https://images.autouncle.com/de/car_images/a.webp') && !img('https://images.autouncle.com.evil.com/a.webp') && !img('http://images.autouncle.com/a.webp'), 'autouncle photos (images.autouncle.com) may be shown through the photo proxy; look-alikes and plain http may not');
}

finish();
