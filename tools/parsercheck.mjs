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

finish();
