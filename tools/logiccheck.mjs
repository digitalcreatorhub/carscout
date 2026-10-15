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
    expect: v => [[!/Подозрительно/.test(v.verdict), 'a German car compared with Latvia is never called suspicious', v.verdict], [/похожих там нашлось мало/.test(v.basis), 'the app says why it compares with Latvia', v.basis], [!v.fraud, 'no scam warning', v.fraud]] }
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
      if (x.pathname === '/api/listing') body = { ok: true, title: 'Audi A6 Avant', source: sc.cc ? 'autoscout24' : 'ss', listing: { make: 'Audi', model: 'A6', year: 2018, mileage_km: 150000, asking_price: sc.price, fuel: 'diesel', gearbox: 'automatic', engine_l: 2.0, description: 'Audi A6 Avant 2.0 TDI', src: {} } };
      else if (x.pathname === '/api/comps') { const s = x.searchParams.get('source'), cy = x.searchParams.get('cy'); const its = s === 'ss' ? sc.comps.ss : s === 'as24' ? sc.comps[cy] : null; body = its ? { ok: true, items: its } : { ok: false, error: 'blocked' }; }
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
  const v = { verdict: await t('#a-verdict .vk', 200) + ' ' + await t('#a-verdict .vd', 300), region: await t('#a-verdict .am', 60), basis: await t('#a-verdict .vbase', 500), fraud: await t('#a-fraud', 200),
    msg: await t('#msg-text', 400), msgLang: await pg.$eval('#msg-lang', e => e.value).catch(() => ''), calc: await pg.$$eval('#k-lv,#k-de', e => e.map(x => x.id + '=' + x.value).join(' ')).catch(() => ''), checks: await pg.$eval('#a-checks', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '') };
  v.region = v.region.split('·')[0].trim();
  for (const [cond, what, detail] of sc.expect(v)) check(cond, sc.id + ': ' + what, detail);
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
  await pg.tap('#fz-make'); await pg.waitForTimeout(300);
  const makes = await pg.$$eval('#pickpanel .pk-o', e => e.length).catch(() => 0);
  check(makes > 50, 'make picker lists the makes', makes + ' options');
  await pg.tap('#pickpanel .pk-o[data-v="Audi"]').catch(() => { }); await pg.waitForTimeout(400);
  const models = await pg.$$eval('#pickpanel .pk-o', e => e.map(x => x.textContent)).catch(() => []);
  check(models.includes('A6') && !models.includes('Golf'), 'model picker shows only the models of the chosen make', models.slice(0, 6).join(','));
  await pg.tap('#pickpanel .pk-o[data-v="A6"]').catch(() => { }); await pg.waitForTimeout(400);
  check(!(await pg.$('#pickpanel')) && (await pg.$eval('#fz-model', e => e.value).catch(() => '')) === 'A6', 'the list closes after picking a model');
  await pg.tap('#modebar [data-mode=sell]'); await pg.waitForTimeout(400);
  check(/Оценить|Value my car/.test(await pg.$eval('#btn-go', e => e.textContent).catch(() => '')), 'Value my car: the mode opens');
  await pg.tap('#modebar [data-mode=sell]'); await pg.waitForTimeout(400);
  check(await pg.$eval('#f-url', e => e.offsetParent !== null).catch(() => false), 'a second tap returns to checking a listing');
  await ctx.close();
}
await b.close();
check(!errs.length, 'no script errors on the page', errs.slice(0, 5).join(' | '));

const report = `\n## Logic check (test scenarios in the live app)\n\n${fails.length ? `### Problems (${fails.length})\n${fails.join('\n')}\n\n` : '**All scenarios passed.**\n\n'}### Passed\n${oks.join('\n')}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
fs.appendFileSync('selfcheck-report.md', report);
if (fails.length) fs.writeFileSync('selfcheck-failed.txt', '1');
process.exitCode = 0;
