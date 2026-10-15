// "Find me a car": asks the worker to re-check the saved searches one by one (each call checks one search × market × model
// that has not been checked for 15 minutes) until there is nothing left. The worker itself sends the phone notifications.
const W = process.env.WORKER || 'https://carscout.pmax70095.workers.dev';
const MAX = parseInt(process.env.PUSH_TICKS || '60', 10);
let n = 0, fresh = 0;
for (; n < MAX; n++) {
  let j = null;
  try { const r = await fetch(W + '/api/push/tick', { headers: { origin: 'https://digitalcreatorhub.github.io' }, signal: AbortSignal.timeout(90000) }); j = await r.json(); }
  catch (e) { console.log('tick failed:', String(e)); break; }
  if (!j || !j.ok || j.idle) { if (j && !j.ok) console.log('tick:', JSON.stringify(j)); break; }
  if (j.fresh) fresh += j.fresh;
  console.log('tick', n + 1, JSON.stringify(j));
}
console.log('done: ' + n + ' checks, ' + fresh + ' new cars');
