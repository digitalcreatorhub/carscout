// CarScout daily logic check: opens the live site in a real browser and runs fixed scenarios with known numbers
// (the worker answers are replaced by test data, so the result does not depend on what is on sale today).
// It checks that the conclusions are right for a buyer in Latvia: the market used, "suspiciously cheap" only when it
// is justified, a car abroad compared with its own country, the calculator, the message, the pickers and the modes.
// Run: node tools/logiccheck.mjs   (SITE=file:///…/index.html to check a local build)
import { chromium } from 'playwright';
import fs from 'node:fs';
const SITE = process.env.SITE || 'https://digitalcreatorhub.github.io/carscout/';
const API = 'https://carscout.pmax70095.workers.dev';
const fails = [], oks = [];
const check = (cond, what, detail) => { if (cond) oks.push(`- ${what}`); else fails.push(`- **${what}**: ${detail || 'failed'}`); };

const ssUrl = k => `https://www.ss.com/msg/ru/transport/cars/audi/a6/t${k}abcde.html`;
const asUrl = k => `https://www.autoscout24.de/angebote/audi-a6-avant-1b2c3d4e-1111-2222-3333-4444555566${String(k).padStart(2, '0')}`;
const items = (n, mid, kind) => Array.from({ length: n }, (_, k) => ({ price: Math.round(mid + (k - (n - 1) / 2) * 200), km: 150000 + (k % 5) * 4000 - 8000, year: 2018 + (k % 3) - 1, url: kind === 'ss' ? ssUrl(k) : asUrl(k), title: 'Audi A6 Avant 2.0 TDI', fuel: 'diesel', gear: 'automatic' }));

const mixItems = (n, mid, title, off) => Array.from({ length: n }, (_, k) => ({ price: Math.round(mid + (k - (n - 1) / 2) * 200), km: 150000 + (k % 5) * 4000 - 8000, year: 2018 + (k % 3) - 1, url: ssUrl(off + k), title, fuel: 'diesel', gear: 'automatic' }));

/* every scenario: the listing, what each market returns, what the app must conclude */
const SCEN = [
  { id: 'lv-fair', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzlvfair.html', price: 15200, comps: { ss: items(20, 15500, 'ss'), D: items(20, 12000, 'as') },
    expect: v => [[v.region === 'Латвия', 'a Latvian ad is compared with Latvia', v.region], [/Рыночная цена/.test(v.verdict), 'a fair price is called fair', v.verdict], [!v.fraud, 'no scam warning', v.fraud]] },
  { id: 'lv-very-cheap', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzlvcheap.html', price: 9500, comps: { ss: items(20, 15500, 'ss'), D: items(20, 12000, 'as') },
    expect: v => [[/Подозрительно/.test(v.verdict), '39% under the Latvian market with 20 ads is suspicious', v.verdict], [!!v.fraud, 'the scam block shows the price signal', 'no scam block']] },
  { id: 'lv-cheap-few', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzlvfew.html', price: 10500, comps: { ss: items(6, 15500, 'ss'), D: items(4, 12000, 'as') },
    expect: v => [[!/Подозрительно/.test(v.verdict) && /Ниже рынка/.test(v.verdict), 'with only 6 ads it is "below market", not "suspicious"', v.verdict]] },
  { id: 'de-own-market', url: asUrl(99), cc: 'DE', price: 11000, comps: { ss: items(20, 15500, 'ss'), D: items(24, 11400, 'as') },
    expect: v => [[v.region === 'Германия', 'a German ad is compared with Germany', v.region], [/Рыночная цена|Ниже рынка/.test(v.verdict) && !/Подозрительно/.test(v.verdict), 'a normal German price is not called suspicious', v.verdict],
      [/В Латвии похожие стоят около/.test(v.basis), 'the Latvian price is shown next to it', v.basis], [!v.fraud, 'no scam warning for a German ad', v.fraud],
      [v.msgLang === 'de' && /Lettland/.test(v.msg), 'the message to the seller is in German and says the buyer is from Latvia', v.msgLang + ': ' + v.msg.slice(0, 80)],
      [v.calc === 'k-lv=15500 k-de=11000' || /k-de=11000/.test(v.calc), 'the calculator puts this car on the import side', v.calc],
      [!/csdd\.lv \(|техосмотров \(csdd/.test(v.checks) && /Teil II/.test(v.checks), 'the checklist fits a German car (no csdd history, both German papers)', v.checks.slice(0, 200)]] },
  { id: 'de-few-german', url: asUrl(98), cc: 'DE', price: 10500, comps: { ss: items(20, 15500, 'ss'), D: items(3, 11400, 'as') },
    expect: v => [[!/Подозрительно/.test(v.verdict), 'a German car compared with Latvia is never called suspicious', v.verdict], [/похожих там нашлось мало/.test(v.basis), 'the app says why it compares with Latvia', v.basis], [!v.fraud, 'no scam warning', v.fraud]] },
  /* ss.lv and auto24 (cars standing in Latvia) are one market: pooled, and a car listed on both sites counts once (12 + 10 - 3 = 19) */
  { id: 'lv-ss-plus-auto24', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzlvmix.html', price: 15200,
    comps: { ss: items(12, 15500, 'ss'), a24lv: [...items(12, 15500, 'ss').slice(0, 3).map((i, k) => ({ ...i, url: 'https://www.auto24.ee/soidukid/' + (5000000 + k) })), ...items(7, 15500, 'ss').map((i, k) => ({ ...i, url: 'https://www.auto24.ee/soidukid/' + (5000100 + k) }))] },
    expect: v => [[v.region === 'Латвия', 'a Latvian ad is compared with Latvia', v.region], [/19 похожих/.test(v.basis), 'ss.lv + auto24 pooled, the 3 cars on both sites counted once: 19 ads', v.basis]] },
  /* an auto24.lv link of a car standing in Estonia: the worker says country EE, so Estonia is its own market, Latvia next to it */
  { id: 'a24-lv-link-car-in-ee', url: 'https://www.auto24.lv/lietoti/4361580', price: 11000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 11000, fuel: 'diesel', gearbox: 'automatic', engine_l: 2.0, country: 'EE', description: 'Audi A6 Avant 2.0 TDI', src: {} },
    comps: { ss: items(20, 15500, 'ss'), ee: items(20, 11400, 'ss').map((i, k) => ({ ...i, url: 'https://autoportaal.ee/et/kasutatud-autod/' + (900 + k) })),
      /* auto24 Estonia also finds this very car (same id on auto24.ee): it must not be counted as a similar car */
      a24ee: [{ price: 11000, km: 150000, year: 2018, url: 'https://www.auto24.ee/soidukid/4361580', title: 'Audi A6 2.0 140kW', fuel: 'diesel', gear: 'automatic', engine_l: 2.0 }] },
    expect: v => [[v.region === 'Эстония', 'a car standing in Estonia (auto24.lv link) is compared with Estonia', v.region],
      [/20 похожих/.test(v.basis), 'the car itself (found again on auto24.ee) is not counted among similar cars: 20 ads, not 21', v.basis],
      [!/Подозрительно/.test(v.verdict), 'a normal Estonian price is not called suspicious because Latvia is dearer', v.verdict], [/В Латвии похожие стоят около/.test(v.basis), 'the Latvian price is shown next to it', v.basis]] },
  /* Audi A6 3.0 BiTDI (two turbos) costs far more than a plain 3.0 TDI. The engine size is the same, so the match has to read the
     variant from the title / text: a BiTDI is compared with BiTDI ads, a plain car with plain ads. */
  { id: 'biturbo-matched', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzbitdi.html', price: 27000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 27000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 BiTDI quattro 313 ZS, S line', src: {} },
    comps: { ss: [...mixItems(8, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0), ...mixItems(8, 27000, 'Audi A6 Avant 3.0 BiTDI quattro', 20)] },
    expect: v => [[/8 похожих/.test(v.basis), 'a BiTDI is compared only with the 8 BiTDI ads, not with the plain 3.0 TDI', v.basis], [/Рыночная цена/.test(v.verdict), 'a BiTDI at the BiTDI price is a fair price (not "above market" against plain 3.0 TDI)', v.verdict],
      [!/ориентировочно/i.test(v.verdict + v.basis), 'with 8 matched ads the verdict is not marked approximate', v.verdict]] },
  { id: 'plain-excludes-biturbo', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzplain3.html', price: 21000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 21000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 TDI quattro', src: {} },
    comps: { ss: [...mixItems(8, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0), ...mixItems(8, 27000, 'Audi A6 Avant 3.0 BiTDI quattro', 20)] },
    expect: v => [[/8 похожих/.test(v.basis), 'a plain 3.0 TDI is compared with the 8 plain ads, the BiTDI ads are left out', v.basis], [/Рыночная цена/.test(v.verdict), 'a plain 3.0 TDI at the plain price is a fair price', v.verdict]] },
  { id: 'biturbo-few-matching', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzbitdi2.html', price: 27000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 27000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 Biturbo quattro', src: {} },
    comps: { ss: [...mixItems(14, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0), ...mixItems(3, 27000, 'Audi A6 Avant 3.0 BiTDI quattro', 20)] },
    expect: v => [[/ориентировочно/i.test(v.verdict), 'only 3 BiTDI ads: the verdict is marked approximate, not shown as a firm "above market"', v.verdict], [/Ориентировочная оценка/.test(v.basis) && /BiTDI/.test(v.basis), 'the basis says the engine variant is not fully matched', v.basis]] },
  { id: 'few-ads-approximate', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzfewap.html', price: 21000, comps: { ss: items(6, 15500, 'ss') },
    expect: v => [[/ориентировочно/i.test(v.verdict), 'with only 6 similar ads the verdict is marked approximate', v.verdict], [/мало похожих объявлений \(6\)/.test(v.basis), 'and says why: few ads (6)', v.basis]] },
  { id: 'twenty-ads-firm', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zztwenty.html', price: 15200, comps: { ss: items(20, 15500, 'ss') },
    expect: v => [[!/ориентировочно/i.test(v.verdict + v.basis), 'with 20 similar ads in a narrow range the verdict is not marked approximate', v.verdict]] },
  /* the closest real listings follow the comparison: the same engine variant, and the car's own market first (Latvian ads before German ones) */
  { id: 'near-biturbo-only', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zznear1.html', price: 27000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 27000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 BiTDI quattro 313 ZS', src: {} },
    comps: { ss: [...mixItems(8, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0), ...mixItems(8, 27000, 'Audi A6 Avant 3.0 BiTDI quattro', 20)], D: Array.from({ length: 12 }, (_, k) => ({ price: 17500 + k * 100, km: 150000, year: 2018, url: asUrl(10 + k), title: 'Audi A6 Avant 3.0 TDI S Line Quattro', fuel: 'diesel', gear: 'automatic' })) },
    expect: v => [[/BiTDI/.test(v.near), 'the closest listings of a BiTDI are BiTDI ads', v.near.slice(0, 300)], [!/3\.0 TDI quattro|3\.0 TDI S Line/.test(v.near), 'no plain 3.0 TDI among the closest listings of a BiTDI', v.near.slice(0, 300)], [!/Германия/.test(v.near), 'no German ads when the Latvian market has enough matching ones', v.near.slice(0, 300)]] },
  { id: 'near-plain-without-biturbo', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zznear2.html', price: 21000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 21000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 TDI quattro', src: {} },
    comps: { ss: [...mixItems(8, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0), ...mixItems(8, 27000, 'Audi A6 Avant 3.0 BiTDI quattro', 20)] },
    expect: v => [[v.near.length > 0 && !/BiTDI/.test(v.near), 'the closest listings of a plain 3.0 TDI do not include BiTDI ads', v.near.slice(0, 300)]] },
  { id: 'near-no-same-engine', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zznear3.html', price: 27000,
    listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 27000, fuel: 'diesel', gearbox: 'automatic', engine_l: 3.0, description: 'Audi A6 Avant 3.0 BiTDI quattro', src: {} },
    comps: { ss: mixItems(12, 21000, 'Audi A6 Avant 3.0 TDI quattro', 0) },
    expect: v => [[v.near === '', 'a BiTDI with no BiTDI ad among the found ones gets no list of "closest" plain cars', v.near.slice(0, 200)]] },
  /* an ad that says it is already sold is not for sale: it must not count among the similar cars */
  { id: 'sold-ads-excluded', url: 'https://www.ss.com/msg/ru/transport/cars/audi/a6/zzsold.html', price: 15500,
    comps: { ss: [...mixItems(8, 15500, 'Audi A6 Avant 2.0 TDI', 0), ...mixItems(6, 9000, 'Audi A6 Avant 2.0 TDI | VERKOCHT', 20)] },
    expect: v => [[/8 похожих/.test(v.basis), 'six ads marked "VERKOCHT" (sold) are not counted: 8 similar cars, not 14', v.basis], [/Рыночная цена/.test(v.verdict), 'and they do not pull the fair price down', v.verdict]] },
];

const b = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const errs = [];
for (const sc of SCEN) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(sc.id + ': ' + e.message));
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith(API)) {
      const x = new URL(u); let body = { ok: true, version: 'test' };
      if (x.pathname === '/api/listing') body = { ok: true, title: 'Audi A6 Avant', source: sc.listing ? new URL(sc.url).hostname : sc.cc ? 'autoscout24' : 'ss', parser: sc.listing ? 'auto24' : undefined, listing: sc.listing || { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: sc.price, fuel: 'diesel', gearbox: 'automatic', engine_l: 2.0, description: 'Audi A6 Avant 2.0 TDI', src: {} } };
      else if (x.pathname === '/api/comps') { const s = x.searchParams.get('source'), cy = x.searchParams.get('cy'); const its = s === 'ss' ? sc.comps.ss : s === 'as24' ? sc.comps[cy] : s === 'autoportaal' ? sc.comps.ee : s === 'auto24' ? sc.comps['a24' + String(x.searchParams.get('cc')).toLowerCase()] : s === 'autogidas' ? sc.comps.ag : null; body = its ? { ok: true, items: its } : { ok: false, error: 'blocked' }; }
      else if (x.pathname !== '/') body = { ok: false, error: 'test' };
      return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort();
    return r.continue();
  });
  await pg.addInitScript(() => { try { localStorage.setItem('carscout_lang', 'ru'); localStorage.setItem('carscout_api', 'https://carscout.pmax70095.workers.dev'); } catch (e) { } });
  await pg.goto(SITE + (SITE.startsWith('file:') ? '' : '?r=' + Date.now()));
  await pg.waitForTimeout(800);
  await pg.fill('#f-url', sc.url); await pg.click('#btn-go');
  const okV = await pg.waitForSelector('#a-verdict', { timeout: 30000 }).then(() => true, () => false);
  if (!okV) { check(false, sc.id + ': analysis opens', 'no verdict panel'); await ctx.close(); continue; }
  await pg.waitForTimeout(800);
  const t = async (sel, n = 2000) => pg.$eval(sel, (e, n) => (e.value != null && e.tagName === 'TEXTAREA' ? e.value : e.innerText).replace(/\s+/g, ' ').slice(0, n), n).catch(() => '');
  const v = { verdict: await t('#a-verdict .vk', 200) + ' ' + await t('#a-verdict .vd', 300), region: await t('#a-verdict .am', 60), basis: await t('#a-verdict .vbase', 500), fraud: await t('#a-fraud', 200), near: await t('#a-near', 3000),
    msg: await t('#msg-text', 400), msgLang: await pg.$eval('#msg-lang', e => e.value).catch(() => ''), calc: await pg.$$eval('#k-lv,#k-de', e => e.map(x => x.id + '=' + x.value).join(' ')).catch(() => ''), checks: await pg.$eval('#a-checks', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '') };
  v.region = v.region.split('·')[0].trim();
  for (const [cond, what, detail] of sc.expect(v)) check(cond, sc.id + ': ' + what, detail);
  await ctx.close();
}

/* the site (auto24.lv) does not give the page to the server: the buyer pastes the listing text. The engine size has to be read from
   that text, otherwise the car is compared with every engine of the model and a fair price looks far too low. */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pasted-text: ' + e.message));
  const mixed = [...Array.from({ length: 12 }, (_, k) => ({ price: 15300 + k * 40, km: 150000 + (k % 5) * 3000 - 6000, year: 2018 + (k % 3) - 1, url: ssUrl(k), title: 'Audi A6 Avant 2.0 TDI', fuel: 'diesel', gear: 'automatic' })),
    ...Array.from({ length: 12 }, (_, k) => ({ price: 25800 + k * 40, km: 150000 + (k % 5) * 3000 - 6000, year: 2018 + (k % 3) - 1, url: ssUrl(50 + k), title: 'Audi A6 Avant 3.0 TDI quattro', fuel: 'diesel', gear: 'automatic' }))];
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith(API)) {
      const x = new URL(u); let body = { ok: true, version: 'test' };
      if (x.pathname === '/api/listing') body = { ok: false, error: 'blocked', message: 'The site refused the server request (HTTP 403).' };
      else if (x.pathname === '/api/comps') body = x.searchParams.get('source') === 'ss' ? { ok: true, items: mixed } : { ok: false, error: 'blocked' };
      else if (x.pathname !== '/') body = { ok: false, error: 'test' };
      return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort();
    return r.continue();
  });
  await pg.addInitScript(() => { try { localStorage.setItem('carscout_lang', 'ru'); localStorage.setItem('carscout_api', 'https://carscout.pmax70095.workers.dev'); } catch (e) { } });
  await pg.goto(SITE + (SITE.startsWith('file:') ? '' : '?r=' + Date.now())); await pg.waitForTimeout(800);
  await pg.fill('#f-url', 'https://www.auto24.lv/lietoti/4361580');
  await pg.evaluate(() => { document.querySelector('#f-text').value = 'Audi A6 Avant 2018\nCena 15200 €\nNobraukums 150000 km\nMotora tilpums 1968 cm3\nDegviela Dīzelis\nPārnesumkārba Automāts\nPatēriņš 5.4 l/100 km'; });
  await pg.click('#btn-go');
  const okP = await pg.waitForSelector('#a-verdict', { timeout: 30000 }).then(() => true, () => false);
  if (!okP) check(false, 'pasted text: analysis opens', 'no verdict panel');
  else {
    await pg.waitForTimeout(800);
    const eng = await pg.$eval('#f-eng', e => e.value).catch(() => '');
    const verdict = await pg.$eval('#a-verdict .vk', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    check(eng === '2.0', 'pasted text (site blocked): the engine size is read from the text, not left empty', 'f-eng=' + eng);
    check(/Рыночная цена/.test(verdict), 'pasted text (site blocked): 2.0 is compared with 2.0 ads, so a fair price is called fair (not "below market")', verdict);
  }
  /* the same ad without an engine line: fuel consumption (l/100 km) and prices must not be taken for an engine size */
  await pg.evaluate(() => { document.querySelector('#f-text').value = 'Audi A6 Avant 2018\nCena 15.200 €\nNobraukums 150000 km\nDegviela Dīzelis\nPatēriņš 5.4 l/100 km'; });
  await pg.waitForFunction(() => !document.querySelector('#btn-go').disabled, null, { timeout: 30000 }).catch(() => { });
  await pg.click('#btn-go'); await pg.waitForTimeout(500);
  await pg.waitForFunction(() => !document.querySelector('#btn-go').disabled, null, { timeout: 30000 }).catch(() => { });
  await pg.waitForTimeout(500);
  const eng2 = await pg.$eval('#f-eng', e => e.value).catch(() => 'n/a');
  check(eng2 === '', 'pasted text without an engine line: fuel consumption (5.4 l/100 km) and the price are not taken for an engine size', 'f-eng=' + eng2);
  await ctx.close();
}

/* favourites: "Check prices now" has to answer inside the favourites box (the page status line is at the top, out of sight), and a favourite
   that is analysed again gets its verdict refreshed with a date (it was a snapshot of the market of the day it was saved) */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('favourites: ' + e.message));
  const favs = [0, 1, 2].map(k => ({ id: ssUrl(70 + k), url: ssUrl(70 + k), make: 'Audi', model: 'A6', year: 2018, km: 150000, price: 20000, fuel: 'diesel', fair: 22000, delta: -9.1, verdict: 'good', savedAt: 1, checkedAt: 1, hist: [{ t: 1, p: 20000 }], sel: true }));
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith(API)) {
      const x = new URL(u); let body = { ok: true, version: 'test' };
      if (x.pathname === '/api/listing') body = { ok: true, title: 'Audi A6 Avant', source: 'ss', listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: 19000, fuel: 'diesel', gearbox: 'automatic', engine_l: 2.0, description: 'Audi A6 Avant 2.0 TDI', src: {} } };
      else if (x.pathname === '/api/comps') body = x.searchParams.get('source') === 'ss' ? { ok: true, items: items(20, 15500, 'ss') } : { ok: false, error: 'blocked' };
      else if (x.pathname !== '/') body = { ok: false, error: 'test' };
      return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort();
    return r.continue();
  });
  await pg.addInitScript(f => { try { localStorage.setItem('carscout_lang', 'ru'); localStorage.setItem('carscout_api', 'https://carscout.pmax70095.workers.dev'); localStorage.setItem('carscout_favs', JSON.stringify(f)); localStorage.setItem('carscout_favs_at', String(Date.now())); } catch (e) { } }, favs);
  await pg.goto(SITE + (SITE.startsWith('file:') ? '' : '?r=' + Date.now())); await pg.waitForTimeout(1200);
  const hasBtn = await pg.waitForSelector('[data-act=fav-recheck]', { timeout: 10000 }).then(() => true, () => false);
  check(hasBtn, 'favourites: the list with the "Check prices now" button is shown', 'no button');
  if (hasBtn) {
    await pg.click('[data-act=fav-recheck]');
    const done = await pg.waitForFunction(() => /Изменения|Проверено/.test((document.getElementById('favstat') || {}).textContent || ''), null, { timeout: 30000 }).then(() => true, () => false);
    const note = await pg.$eval('#favstat', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
    check(done && /Изменения: .*Audi A6/.test(note), 'favourites: "Check prices now" answers inside the favourites box (3 cars checked, the price change is named)', note);
    const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('carscout_favs') || '[]'));
    check(saved.length === 3 && saved.every(f => f.price === 19000), 'favourites: the new price is saved for all 3 cars', JSON.stringify(saved.map(f => f.price)));
  }
  await pg.fill('#f-url', favs[0].url); await pg.click('#btn-go');
  const okF = await pg.waitForSelector('#a-verdict', { timeout: 30000 }).then(() => true, () => false);
  if (!okF) check(false, 'favourites: analysis opens', 'no verdict panel');
  else {
    await pg.waitForTimeout(800);
    const f0 = (await pg.evaluate(() => JSON.parse(localStorage.getItem('carscout_favs') || '[]')))[0] || {};
    check(f0.verdict && f0.verdict !== 'good' && f0.vAt > 1 && f0.vN === 20, 'favourites: a favourite analysed again gets the fresh verdict (not the old "below market") with its date and the number of comparables', JSON.stringify({ v: f0.verdict, vAt: f0.vAt, vN: f0.vN }));
    const row = await pg.$eval('#favs', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    check(/20 аналог/.test(row) && /на \d\d\.\d\d\)/.test(row), 'favourites: the row shows how many cars it was compared with and the date', row.slice(0, 300));
  }
  await ctx.close();
}

/* computer width: opened "Enter details manually" uses the whole width (it was one narrow column with an empty screen beside it) */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
  await pg.route('**/*', r => { const u = r.request().url(); if (u.startsWith(API)) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"ok":true}' }); if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort(); return r.continue(); });
  await pg.goto(SITE + (SITE.startsWith('file:') ? '' : '?r=' + Date.now())); await pg.waitForTimeout(800);
  const m = await pg.evaluate(() => { document.getElementById('intake').classList.add('open'); document.getElementById('manual').open = true; const f = document.getElementById('intake').getBoundingClientRect(), r = document.getElementById('manual').getBoundingClientRect(); return { share: r.width / f.width, h: Math.round(r.height) }; }).catch(e => ({ err: e.message }));
  check(m.share > 0.9 && m.h < 420, 'computer width: the opened manual fields span the form width in columns, not one tall narrow column', JSON.stringify(m));
  await ctx.close();
}

/* the modes and the pickers */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('modes: ' + e.message));
  await pg.route('**/*', r => { const u = r.request().url(); if (u.startsWith(API)) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"ok":true}' }); if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort(); return r.continue(); });
  await pg.goto(SITE + (SITE.startsWith('file:') ? '' : '?r=' + Date.now())); await pg.waitForTimeout(800);
  const btn = await pg.$eval('#btn-go', e => e.textContent).catch(() => '');
  check(/Проверить объявление|Check the listing|Pārbaudīt/.test(btn), 'start screen: the main button checks a listing', btn);
  await pg.tap('#modebar [data-mode=find]'); await pg.waitForTimeout(400);
  check(await pg.$eval('#findbox', e => e.offsetParent !== null).catch(() => false), 'Find me a car: the form opens');
  check(await pg.$eval('#fz-engf', e => e.options.length > 5).catch(() => false) && !!(await pg.$('#fz-engt')), 'agent form: engine size from / to selects are there');
  const engOk = await pg.evaluate(() => fzFilter([{ title: 'Audi A6 2.0 TDI', d: 0 }, { title: 'Audi A6', engine_l: 3.0, d: 0 }, { title: 'Audi A6 1.8', d: 0 }, { title: 'Audi A6 plain', d: 0 }, { title: 'Audi A6 3.5 TFSI', d: 0 }], { engf: 2, engt: 3 }).map(x => x.title).join('|')).catch(e => 'error ' + e.message);
  check(engOk === 'Audi A6 2.0 TDI|Audi A6|Audi A6 plain', 'agent engine size 2.0–3.0 l: keeps matching ads and ads with no stated size, drops 1.8 and 3.5', engOk);
  const varOk = await pg.evaluate(() => { const mk = document.getElementById('fz-make'), md = document.getElementById('fz-model'); mk.value = 'Mercedes-Benz'; const l = pickList(md, true).all; mk.value = ''; return JSON.stringify([l.includes('E 300'), l.includes('E-Class'), varFamily('Mercedes-Benz', 'E 350'), varOk('Mercedes-Benz E300 2.0', ['E 300']), varOk('Mercedes GLE 300 d', ['E 300']), varOk('Mercedes E 350 CDI', ['E 300'])]); }).catch(e => 'error ' + e.message);
  check(varOk === '[true,true,"E-Class",true,false,false]', 'agent models: exact variants (E 300, E 350 ...) are in the Mercedes list next to the line, belong to E-Class, and filter ads (E300 yes, GLE 300 no, E 350 no for E 300)', varOk);
  await pg.tap('#fz-make'); await pg.waitForTimeout(300);
  const makes = await pg.$$eval('#pickpanel .pk-o', e => e.length).catch(() => 0);
  check(makes > 50, 'make picker lists the makes', makes + ' options');
  await pg.tap('#pickpanel .pk-o[data-v="Audi"]').catch(() => { }); await pg.waitForTimeout(400);
  const models = await pg.$$eval('#pickpanel .pk-o', e => e.map(x => x.textContent)).catch(() => []);
  check(models.includes('A6') && !models.includes('Golf'), 'model picker shows only the models of the chosen make', models.slice(0, 6).join(','));
  await pg.tap('#pickpanel .pk-o[data-v="A6"]').catch(() => { }); await pg.waitForTimeout(400);
  check(!(await pg.$('#pickpanel')) && (await pg.$eval('#fz-model', e => e.value).catch(() => '')) === 'A6', 'the list closes after picking a model');
  check(await pg.$eval('#mode-back', e => !e.hidden && e.offsetParent !== null).catch(() => false), 'a visible "back to checking a listing" button in the agent mode');
  await pg.tap('#mode-back').catch(() => { }); await pg.waitForTimeout(400);
  check(await pg.$eval('#f-url', e => e.offsetParent !== null).catch(() => false) && await pg.$eval('#mode-back', e => e.hidden).catch(() => false), 'the back button returns to the link field');
  await pg.tap('#modebar [data-mode=sell]'); await pg.waitForTimeout(400);
  check(/Оценить|Value my car/.test(await pg.$eval('#btn-go', e => e.textContent).catch(() => '')), 'Value my car: the mode opens');
  await pg.tap('#modebar [data-mode=sell]'); await pg.waitForTimeout(400);
  check(await pg.$eval('#f-url', e => e.offsetParent !== null).catch(() => false), 'a second tap returns to checking a listing');
  await ctx.close();
}
/* auto-update: opening the app compares the published version with the running one. A newer one is picked up by itself (one reload,
   then no loop: the Update button instead); the same version leaves the page alone. Needs http(s), so it is skipped for file:// builds. */
if (!SITE.startsWith('file:')) {
  for (const newer of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' }); const pg = await ctx.newPage(); const navs = [];
    pg.on('framenavigated', f => { if (f === pg.mainFrame()) navs.push(f.url()); });
    await pg.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(API)) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"ok":true}' });
      if (/goatcounter|gc\.zgo\.at|fonts\.g/.test(u)) return r.abort();
      if (newer && u.includes('__upd=1')) return r.fulfill({ status: 200, contentType: 'text/html', body: "<script>var APP_VER = '2099-01-01.1';</script>" });
      return r.continue();
    });
    await pg.goto(SITE + '?r=' + Date.now()); await pg.waitForTimeout(3500);
    const notice = await pg.$('#status [data-act=refresh]');
    if (!newer) check(navs.length === 1 && !notice, 'auto-update: the same published version leaves the page alone', navs.join(' | '));
    else check(navs.length === 2 && /[?&]r=\d+/.test(navs[1]) && !!notice, 'auto-update: a newer published version is loaded by itself once, then no reload loop (the Update button instead)', navs.join(' | ') + (notice ? '' : ' (no button)'));
    await ctx.close();
  }
}
await b.close();
check(!errs.length, 'no script errors on the page', errs.slice(0, 5).join(' | '));

const report = `\n## Logic check (test scenarios in the live app)\n\n${fails.length ? `### Problems (${fails.length})\n${fails.join('\n')}\n\n` : '**All scenarios passed.**\n\n'}### Passed\n${oks.join('\n')}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
fs.appendFileSync('selfcheck-report.md', report);
if (fails.length) fs.writeFileSync('selfcheck-failed.txt', '1');
process.exitCode = 0;
