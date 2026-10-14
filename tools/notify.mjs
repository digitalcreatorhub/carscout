// CarScout Telegram alerts. Runs on a schedule in GitHub Actions.
// Reads new /start and /stop messages for the bot, then for every linked user re-checks their favourite ads
// (price drops, removed ads) and saved searches (new cars below the market), and sends Telegram messages.
// The bot token lives only in the TG_TOKEN repository secret. State (who is linked, what was already sent) is kept
// in a JSON file restored from the Actions cache between runs.
import fs from 'node:fs';

const TOKEN = process.env.TG_TOKEN || '';
const W = process.env.WORKER || 'https://carscout.pmax70095.workers.dev';
const STATE = process.env.STATE_FILE || 'tgstate/state.json';
const H = { origin: 'https://digitalcreatorhub.github.io' };
if (!TOKEN) { fs.mkdirSync(STATE.replace(/\/[^/]+$/, ''), { recursive: true }); if (!fs.existsSync(STATE)) fs.writeFileSync(STATE, '{}'); console.log('TG_TOKEN is not set: nothing to do.'); process.exit(0); }

const TG = 'https://api.telegram.org/bot' + TOKEN + '/';
async function tg(method, body) {
  try { const r = await fetch(TG + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e) { return { ok: false, description: String(e) }; }
}
async function get(path, params, ms) {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== '')).toString();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 60000);
  try { const r = await fetch(W + path + (qs ? '?' + qs : ''), { headers: H, signal: ctl.signal }); return await r.json(); }
  catch (e) { return { ok: false, error: 'network', message: String(e) }; } finally { clearTimeout(t); }
}
let state = { offset: 0, subs: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch (e) { }
const save = () => { fs.mkdirSync(STATE.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };

const T = {
  ru: { linked: '✅ CarScout подключён. Буду присылать снижение цен в избранном и новые выгодные машины из ваших сохранённых поисков. Отключить: /stop', stop: 'Уведомления отключены. Подключить снова можно в приложении CarScout.', help: 'Чтобы подключить уведомления, откройте CarScout → «Избранное» или «Выгодные» → «Уведомления в Telegram».', drop: 'Цена снизилась', up: 'Цена выросла', gone: 'Объявление снято (вероятно, продано)', deals: 'Новые машины ниже рынка', market: 'рынок' },
  lv: { linked: '✅ CarScout pieslēgts. Sūtīšu cenu samazinājumus izlasē un jaunus izdevīgus auto no jūsu saglabātajām meklēšanām. Atslēgt: /stop', stop: 'Paziņojumi atslēgti. Pieslēgt atkal var lietotnē CarScout.', help: 'Lai pieslēgtu paziņojumus, atveriet CarScout → «Izlase» vai «Izdevīgie» → «Paziņojumi Telegram».', drop: 'Cena samazinājās', up: 'Cena pieauga', gone: 'Sludinājums noņemts (iespējams, pārdots)', deals: 'Jauni auto zem tirgus', market: 'tirgus' },
  en: { linked: '✅ CarScout is connected. I will send price drops in your favourites and new good deals from your saved searches. To turn off: /stop', stop: 'Alerts are off. You can turn them on again in the CarScout app.', help: 'To turn on alerts, open CarScout → “Favourites” or “Deals” → “Telegram alerts”.', drop: 'Price dropped', up: 'Price went up', gone: 'Ad removed (probably sold)', deals: 'New cars below the market', market: 'market' }
};
const eur = (x) => (Math.round(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
const fmt = (x) => (Math.round(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* 1. new links from the bot chat */
const up = await tg('getUpdates', { offset: (state.offset || 0) + 1, timeout: 0, allowed_updates: ['message'] });
for (const u of (up.ok && up.result) || []) {
  state.offset = Math.max(state.offset || 0, u.update_id);
  const m = u.message; if (!m || !m.text || !m.chat) continue;
  const lang = /^ru/.test(m.from && m.from.language_code || '') ? 'ru' : /^lv/.test(m.from && m.from.language_code || '') ? 'lv' : 'en';
  const mm = m.text.match(/^\/start(?:\s+([a-z0-9]{16,40}))?/i);
  if (mm && mm[1]) { state.subs[mm[1]] = Object.assign(state.subs[mm[1]] || { favs: {}, hunts: {} }, { chat: m.chat.id, lang, since: Date.now() }); await tg('sendMessage', { chat_id: m.chat.id, text: T[lang].linked }); }
  else if (mm) await tg('sendMessage', { chat_id: m.chat.id, text: T[lang].help });
  else if (/^\/stop/i.test(m.text)) { for (const k of Object.keys(state.subs)) if (state.subs[k].chat === m.chat.id) delete state.subs[k]; await tg('sendMessage', { chat_id: m.chat.id, text: T[lang].stop }); }
}
save();

/* the same scoring as the app's "Find good deals": price ~ year + mileage per market */
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
function fitPrice(items) {
  const X = items.filter((i) => i.year && i.km != null && i.price > 0);
  if (X.length >= 10) {
    const n = X.length; let my = 0, mk = 0, mp = 0; X.forEach((i) => { my += i.year; mk += i.km; mp += i.price; }); my /= n; mk /= n; mp /= n;
    let syy = 0, skk = 0, syk = 0, syp = 0, skp = 0; X.forEach((i) => { const a = i.year - my, b = i.km - mk, p = i.price - mp; syy += a * a; skk += b * b; syk += a * b; syp += a * p; skp += b * p; });
    const det = syy * skk - syk * syk;
    if (Math.abs(det) > 1e-6) { const by = (syp * skk - skp * syk) / det, bk = (skp * syy - syp * syk) / det; if (bk < 0 && by > 0) return (i) => mp + by * ((i.year || my) - my) + bk * ((i.km != null ? i.km : mk) - mk); }
  }
  const byY = {}; items.forEach((i) => { if (i.year) (byY[i.year] = byY[i.year] || []).push(i.price); });
  const all = median(items.map((i) => i.price));
  return (i) => { const a = byY[i.year]; return a && a.length >= 3 ? median(a) : all; };
}
async function deals(p) {
  const mk = p.mk || {}, yf = p.yf || (p.yt ? p.yt - 3 : null), yt = p.yt || (p.yf ? p.yf + 3 : null), ymid = yf && yt ? Math.round((yf + yt) / 2) : (yf || yt || '');
  const base = { make: p.make, model: p.model, year: ymid, yfrom: yf || '', yto: yt || '', fuel: p.fuel || '' };
  const jobs = [];
  if (mk.LV) jobs.push(['ss.lv', get('/api/comps', Object.assign({ source: 'ss' }, base))]);
  if (mk.LT) jobs.push(['autoplius.lt', get('/api/comps', Object.assign({ source: 'autoplius' }, base))]);
  if (mk.EE) jobs.push(['autoportaal.ee', get('/api/comps', Object.assign({ source: 'autoportaal' }, base))]);
  for (const [r, cy] of [['DE', 'D'], ['BE', 'B'], ['NL', 'NL'], ['FR', 'F']]) if (mk[r]) jobs.push(['AutoScout24 ' + r, get('/api/comps', Object.assign({ source: 'as24', cy }, base))]);
  const rows = [];
  for (const [label, pr] of jobs) {
    const j = await pr; if (!j.ok) continue;
    const seen = {}; let its = (j.items || []).filter((i) => { if (seen[i.url]) return false; seen[i.url] = 1; return i.price >= 500 && i.year && (!yf || i.year >= yf) && (!yt || i.year <= yt) && (!p.fuel || !i.fuel || (i.fuel === 'lpg' ? 'petrol' : i.fuel) === p.fuel); });
    if (its.length < 5) continue;
    const mid = median(its.map((i) => i.price)); its = its.filter((i) => i.price > mid * 0.3 && i.price < mid * 3);
    const est = fitPrice(its);
    its.forEach((i) => { const e = est(i); if (!(e > 0)) return; const d = (i.price - e) / e * 100;
      if (p.pmax && i.price > p.pmax) return; if (p.kmax && i.km != null && i.km > p.kmax) return; if (p.gear && i.gear && i.gear !== p.gear) return;
      rows.push(Object.assign({ src: label, exp: Math.round(e / 50) * 50, d }, i)); });
  }
  return rows;
}

/* 2. every linked user */
let sent = 0;
for (const [code, sub] of Object.entries(state.subs).slice(0, 100)) {
  const w = await get('/api/watch', { code }, 20000);
  if (!w.ok || w.off) continue;
  const lang = w.lang || sub.lang || 'en', t = T[lang] || T.en, msgs = [];
  sub.favs = sub.favs || {}; sub.hunts = sub.hunts || {};
  for (const f of (w.favs || []).slice(0, 15)) {
    const st = sub.favs[f.url] || { p: f.price || null, gone: false };
    const j = await get('/api/listing', { url: f.url }, 40000);
    const np = j && j.listing && j.listing.asking_price;
    if (np > 0) {
      if (st.p && np < st.p - 50) msgs.push('📉 <b>' + t.drop + '</b>: ' + esc(f.title) + '\n' + eur(st.p) + ' → <b>' + eur(np) + '</b> (−' + eur(st.p - np) + ')\n' + f.url);
      st.p = np; st.gone = false;
    } else if (j && j.ok === false && (j.error === 'not_found' || j.removed) && !st.gone) { st.gone = true; msgs.push('🚫 ' + t.gone + ': ' + esc(f.title) + '\n' + f.url); }
    sub.favs[f.url] = st;
  }
  for (const h of (w.hunts || []).slice(0, 3)) {
    const hs = sub.hunts[h.key] || { seen: [], init: false };
    const rows = await deals(h.p || {}); if (!rows.length) continue;
    const seen = new Set(hs.seen);
    const fresh = rows.filter((x) => x.d >= -35 && x.d < -3 && !seen.has(x.url)).sort((a, b) => a.d - b.d);
    if (hs.init && fresh.length) msgs.push('🔥 <b>' + t.deals + '</b> — ' + esc(h.name) + '\n' + fresh.slice(0, 5).map((x) => '• ' + esc(String(x.title || '').slice(0, 50)) + ', ' + (x.year || '') + (x.km != null ? ', ' + fmt(x.km) + ' km' : '') + '\n  <b>' + eur(x.price) + '</b> (' + t.market + ' ' + eur(x.exp) + ', ' + Math.round(x.d) + '%) · ' + x.src + '\n  ' + x.url).join('\n'));
    rows.forEach((x) => seen.add(x.url)); hs.seen = Array.from(seen).slice(-1500); hs.init = true; sub.hunts[h.key] = hs;
  }
  for (const m of msgs) { const r = await tg('sendMessage', { chat_id: sub.chat, text: m, parse_mode: 'HTML', disable_web_page_preview: true }); if (r.ok) sent++; else if (r.error_code === 403) { delete state.subs[code]; break; } }
  save();
}
console.log('subscribers:', Object.keys(state.subs).length, 'messages sent:', sent);
save();
