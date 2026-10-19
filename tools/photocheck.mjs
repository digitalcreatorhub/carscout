// CarScout check of the "generation from photos" endpoint of the worker (/api/photogen): a vision model (Cloudflare Workers AI) is asked
// to choose between two neighbouring generations of a model from two photos. The AI is a fake here, so this checks OUR side of it:
// what is asked, in which order, when an answer is accepted (only when both photos agree), that bad requests never reach the AI or the
// photo hosts, that a missing / failing AI leaves the app exactly as it was, and the one-time licence step.
// It cannot tell how good the real model is at telling an A6 C7 from a C8: that has to be seen on real ads.
// No network. Run: node tools/photocheck.mjs   (Node 22+)
import { loadWorker, checker } from './lib/offline.mjs';

const { check, finish } = checker('photo generation');
const { ctx, W, pages, calls } = loadWorker();
const jpeg = () => { const b = new Uint8Array(400); b.set([0xFF, 0xD8, 0xFF, 0xE0], 0); return b; };
const IMG1 = 'https://i.ss.com/gallery/6/1/a1.800.jpg', IMG2 = 'https://i.ss.com/gallery/6/1/a2.800.jpg';
pages[IMG1] = { status: 200, body: jpeg() }; pages[IMG2] = { status: 200, body: jpeg() };
const GENS = 'C7~2011|C8~2018';
const qs = (o = {}) => new URLSearchParams({ make: 'Audi', model: 'A6', year: '2018', gens: GENS, img: IMG1, img2: IMG2, ...o });
const ask = async (env, o) => { ctx.__env = env; ctx.__q = qs(o); const r = await W('hPhotoGen(__env, __q, { waitUntil() { } })'); return { status: r.status, j: await r.json() }; };
const fakeAI = (answers, log = []) => ({ log, run: async (model, input) => { log.push({ model, input }); const a = typeof answers === 'function' ? answers(input, log.length) : answers[Math.min(log.length - 1, answers.length - 1)]; if (a instanceof Error) throw a; return { response: a }; } });
const promptOf = (input) => input.prompt || input.messages[0].content[0].text;

/* ---- both photos agree ---- */
let ai = fakeAI(['C8', 'C8']); let r = await ask({ AI: ai });
check(r.status === 200 && r.j.ok && r.j.gen === 'C8' && r.j.votes.join() === 'C8,C8', 'both photos say C8: the answer is C8', r.j);
check(ai.log.length === 2 && ai.log.every(x => x.model === '@cf/meta/llama-3.2-11b-vision-instruct'), 'two questions to the vision model (one per photo)', ai.log.length);
const p1 = promptOf(ai.log[0].input), p2 = promptOf(ai.log[1].input);
check(/Audi A6/.test(p1) && /2018/.test(p1) && /C7 \(on sale from 2011\)/.test(p1) && /C8 \(on sale from 2018\)/.test(p1) && /unknown/.test(p1), 'the question names the car, the year and both generations with their first years, and allows "unknown"', p1);
check(/C7, C8 or unknown/.test(p1) && /C8, C7 or unknown/.test(p2), 'the options come in opposite order for the second photo (a model likes the first or the last option)', [p1.slice(-60), p2.slice(-60)]);
check(ai.log[0].input.messages && /^data:image\/jpeg;base64,/.test(ai.log[0].input.messages[0].content[1].image_url.url), 'the photo goes as a base64 data URL with the type read from the bytes', Object.keys(ai.log[0].input));

/* ---- when the answer is NOT accepted ---- */
r = (await ask({ AI: fakeAI(['C7', 'C8']) })).j; check(r.ok && r.gen === null, 'the photos disagree: no generation', r);
r = (await ask({ AI: fakeAI(['unknown', 'C8']) })).j; check(r.ok && r.gen === null, 'one photo says unknown: no generation', r);
r = (await ask({ AI: fakeAI(['It could be C7 or C8.', 'It could be C7 or C8.']) })).j; check(r.ok && r.gen === null, 'an answer naming both generations is not a choice', r);
r = (await ask({ AI: fakeAI(['The car looks like a Passat.', 'Passat']) })).j; check(r.ok && r.gen === null, 'an answer that names neither generation gives nothing', r);
r = (await ask({ AI: fakeAI(['c8.', ' C8\n']) })).j; check(r.ok && r.gen === 'C8', 'a full stop, spaces and small letters around the answer do not matter', r);
r = (await ask({ AI: fakeAI(['C80', 'C8']) })).j; check(r.ok && r.gen === null, '"C80" is not C8', r);
r = (await ask({ AI: fakeAI(['Golf 8', 'Golf 8']) }, {} )).j; check(r.ok && r.gen === null, 'a name that was not offered gives nothing', r);

/* ---- names with a space (Golf 7 / Golf 8) ---- */
ctx.__env = { AI: fakeAI(['Golf 8', 'Golf 8']) }; ctx.__q = qs({ make: 'Volkswagen', model: 'Golf', year: '2020', gens: 'Golf 7~2012|Golf 8~2020' });
r = await (await W('hPhotoGen(__env, __q, { waitUntil() { } })')).json(); check(r.ok && r.gen === 'Golf 8', 'generation names with a space work (Golf 8)', r);

/* ---- bad requests never reach the AI or a photo host ---- */
const n0 = calls.length; ai = fakeAI(['C8', 'C8']);
for (const [what, o] of [['a photo on a host that is not a car site', { img: 'https://evil.example/x.jpg' }], ['a plain http photo', { img2: 'http://i.ss.com/x.jpg' }], ['the same photo twice', { img2: IMG1 }], ['one photo only', { img2: '' }], ['one generation only', { gens: 'C8~2018' }], ['a bad generation list', { gens: 'C7;drop|C8~2018' }], ['no model', { model: '' }], ['an impossible year', { year: '1850' }]]) {
  const x = await ask({ AI: ai }, o); check(x.status === 400 && x.j.error === 'bad_request', 'refused: ' + what, x);
}
check(ai.log.length === 0 && calls.length === n0, 'and none of those reached the AI or fetched a photo', { ai: ai.log.length, fetched: calls.length - n0 });

/* ---- the AI is not there / fails: the app goes on as before ---- */
const n1 = calls.length;
r = (await ask({})).j; check(r.ok === false && r.error === 'no_ai' && calls.length === n1, 'no AI binding: ok:false "no_ai", and no photo is fetched', r);
r = (await ask({ AI: fakeAI(() => new Error('daily limit reached')) })); check(r.status === 200 && r.j.ok === false && r.j.error === 'ai_failed', 'the AI refuses (allowance used up): ok:false "ai_failed"', r);
ai = fakeAI(() => new Error('boom')); await ask({ AI: ai }); check(ai.log.length <= 2, 'a failing AI is tried at most with the two input forms of one photo, not again and again', ai.log.length);
pages[IMG2] = { status: 200, body: new TextEncoder().encode('<html>not a photo</html>') };
ai = fakeAI(['C8', 'C8']); r = (await ask({ AI: ai })).j; check(r.ok === false && r.error === 'image_unavailable' && ai.log.length === 0, 'a "photo" that is not an image (a page) is not sent to the AI', { r, asked: ai.log.length });
pages[IMG2] = { status: 404, body: '' }; r = (await ask({ AI: fakeAI(['C8', 'C8']) })).j; check(r.ok === false && r.error === 'image_unavailable', 'a photo that is gone gives "image_unavailable"', r);
pages[IMG2] = { status: 200, body: jpeg() };

/* ---- the second input form, and the one-time licence ---- */
ai = fakeAI((input) => input.messages ? new Error('unsupported input') : 'C8'); r = (await ask({ AI: ai })).j; check(r.ok && r.gen === 'C8', 'when the first input form is refused the second one is used', r);
let agreed = false; const calls2 = [];
const licAI = { run: async (m, input) => { calls2.push(input.prompt === 'agree' ? 'agree' : 'ask'); if (input.prompt === 'agree') { agreed = true; return { response: 'Thank you for agreeing' }; } if (!agreed) throw new Error('5016: Prior to using this model, you need to submit the prompt "agree"'); return { response: 'C8' }; } };
r = (await ask({ AI: licAI })).j; check(r.ok && r.gen === 'C8' && calls2.includes('agree'), 'the model asks for its licence once: the worker sends "agree" and asks again', { r, calls2 });

/* ---- the router, the status page, the limits ---- */
const through = async (path, env) => { ctx.__e = env; return JSON.parse(await W(`__worker.fetch(new Request('https://carscout.test${path}'), __e, { waitUntil() { } }).then(function (r) { return r.text(); })`)); };
r = await through('/api/photogen?' + qs().toString(), { ALLOW_ORIGIN: '*', AI: fakeAI(['C8', 'C8']) }); check(r.ok && r.gen === 'C8', 'the endpoint is reachable through the worker router', r);
r = await through('/', { ALLOW_ORIGIN: '*' }); check(r.endpoints.includes('/api/photogen') && r.photoAI === false, 'the status page lists the endpoint and says the AI is not connected', r);
r = await through('/', { ALLOW_ORIGIN: '*', AI: fakeAI(['C8']) }); check(r.photoAI === true, 'and says it is connected when the binding exists (so a wrong deploy can be seen from the status page)', r);
check(W("rlKind('GET', '/api/photogen')") === 'ai' && JSON.parse(W('JSON.stringify(RL_LIMIT)')).ai <= 20, 'the endpoint has its own small request budget', W("rlKind('GET', '/api/photogen')"));

finish();
