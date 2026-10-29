// CarScout check of accounts (worker/worker.js): sign in with Google, the session, and the synced lists, on a real SQLite database.
// Google's token is made here with a throw-away RSA key and the worker is given the matching public key, so the real signature,
// audience, issuer, expiry and e-mail checks run. No network. Run: node tools/accountcheck.mjs   (Node 22+)
import { loadWorker, makeD1, checker, DAY } from './lib/offline.mjs';
import { webcrypto as nodeCrypto } from 'node:crypto';

const { check, finish } = checker('accounts');
const { T, ctx, W, pages } = loadWorker();
const CID = 'test-client.apps.googleusercontent.com';
const DB = makeD1(); ctx.env = { DB, ALLOW_ORIGIN: '*', GOOGLE_CLIENT_ID: CID };
const KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/* Google's key pair (ours, for the test) */
const kp = await nodeCrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await nodeCrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await nodeCrypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
pages[KEYS_URL] = { status: 200, body: JSON.stringify({ keys: [pub] }) };
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const nowS = () => Math.floor(T.now / 1000);
async function idToken(over = {}, { key = kp.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: CID, sub: '1001', email: 'anna@example.com', email_verified: true, name: 'Anna', iat: nowS(), exp: nowS() + 3600, ...over });
  const sig = Buffer.from(await nodeCrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body))).toString('base64url');
  return head + '.' + body + '.' + sig;
}
let seq = 0;
async function call(method, path, { token, body, raw } = {}) {
  ctx.__r = new Request('https://w.example' + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body || raw ? { 'content-type': 'text/plain' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const res = await W('__worker.fetch(__r, env, { waitUntil() {} })');
  return { status: res.status, j: await res.json() };
}
const signIn = async (over, opt) => call('POST', '/api/auth/google', { body: { credential: await idToken(over, opt) } });
const n = (sql, ...a) => DB.raw.prepare(sql).all(...a)[0].n;

/* ---------- 1. the switch ---------- */
let r = await call('GET', '/api/auth/config');
check(r.j.ok && r.j.clientId === CID, 'config: the page learns the Google client id from the server (nothing is hard-coded in the page)', r.j);
ctx.env.GOOGLE_CLIENT_ID = ''; r = await call('GET', '/api/auth/config');
const off = await signIn();
check(r.j.clientId === '' && off.status === 503 && off.j.error === 'auth_off', 'without a client id the whole thing is off: empty config, sign-in refused with auth_off', { cfg: r.j, off });
ctx.env.GOOGLE_CLIENT_ID = CID;

/* ---------- 2. sign-in: only a genuine token for this app gets in ---------- */
const good = await signIn();
check(good.status === 200 && good.j.ok && good.j.email === 'anna@example.com' && /^[A-Za-z0-9_-]{40,}$/.test(good.j.token), 'sign-in: a genuine Google token gives the person a session token and the e-mail', good);
const bad = {
  'another app (wrong audience)': await signIn({ aud: 'someone-else.apps.googleusercontent.com' }),
  'expired token': await signIn({ exp: nowS() - 600, iat: nowS() - 4000 }),
  'foreign issuer': await signIn({ iss: 'https://evil.example' }),
  'e-mail not verified': await signIn({ email_verified: false }),
  'no subject': await signIn({ sub: '' }),
  'signed with another key': await signIn({}, { key: other.privateKey }),
  'unknown key id': await signIn({}, { kid: 'nope' }),
  'alg none': await call('POST', '/api/auth/google', { body: { credential: b64({ alg: 'none', kid: 'k1' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CID, sub: '1', email: 'x@y.z', email_verified: true, exp: nowS() + 600 }) + '.' } }),
  'garbage': await call('POST', '/api/auth/google', { body: { credential: 'abc' } }),
  'nothing': await call('POST', '/api/auth/google', { raw: '{}' })
};
const notRefused = Object.keys(bad).filter(k => bad[k].status !== 401 || bad[k].j.ok);
check(!notRefused.length, 'sign-in: every forged, foreign, expired or unsigned token is refused (401)', { notRefused });
const tampered = (await idToken()).split('.'); tampered[1] = b64({ iss: 'https://accounts.google.com', aud: CID, sub: '1001', email: 'boss@example.com', email_verified: true, exp: nowS() + 3600 });
const tam = await call('POST', '/api/auth/google', { body: { credential: tampered.join('.') } });
check(tam.status === 401, 'sign-in: a token whose content was changed after signing (other e-mail) is refused', tam);
const again = await signIn();
check(again.j.ok && again.j.token !== good.j.token && n('SELECT COUNT(*) AS n FROM acct') === 1 && n('SELECT COUNT(*) AS n FROM sess') === 2, 'sign-in: the same Google person signing in again is the same account with a second session (second device)', { accts: n('SELECT COUNT(*) AS n FROM acct'), sess: n('SELECT COUNT(*) AS n FROM sess') });
check(DB.raw.prepare('SELECT h FROM sess').all().every(x => x.h !== good.j.token && x.h !== again.j.token && /^[0-9a-f]{64}$/.test(x.h)), 'sessions: only a hash of the session token is stored, never the token', null);

/* ---------- 3. synced lists ---------- */
const A = good.j.token, A2 = again.j.token;
const none = await call('GET', '/api/sync'), badTok = await call('GET', '/api/sync', { token: 'x'.repeat(43) });
check(none.status === 401 && badTok.status === 401, 'sync: without a session, or with a made-up one, nothing is read (401)', { none: none.status, badTok: badTok.status });
r = await call('GET', '/api/sync', { token: A });
check(r.j.ok && JSON.stringify(r.j.data) === '{}' && r.j.email === 'anna@example.com', 'sync: a new account starts empty', r.j);
const T1 = T.now - 5000;
r = await call('POST', '/api/sync', { token: A, body: { data: { carscout_favs: { v: '[{"id":"a"}]', t: T1 } } } });
check(r.j.ok && r.j.data.carscout_favs.v === '[{"id":"a"}]', 'sync: a list sent from the first phone is stored', r.j);
r = await call('GET', '/api/sync', { token: A2 });
check(r.j.data.carscout_favs && r.j.data.carscout_favs.v === '[{"id":"a"}]' && r.j.data.carscout_favs.t === T1, 'sync: the second phone (another session of the same person) reads it', r.j);
r = await call('POST', '/api/sync', { token: A2, body: { data: { carscout_favs: { v: '[]', t: T1 - 1000 } } } });
check(r.j.data.carscout_favs.v === '[{"id":"a"}]', 'sync: an older change from the other phone does not overwrite the newer list', r.j);
r = await call('POST', '/api/sync', { token: A2, body: { data: { carscout_favs: { v: '[{"id":"a"},{"id":"b"}]', t: T1 + 1000 }, carscout_finds: { v: '[{"key":"q"}]', t: T1 + 1000 } } } });
const g = await call('GET', '/api/sync', { token: A });
check(g.j.data.carscout_favs.v === '[{"id":"a"},{"id":"b"}]' && g.j.data.carscout_finds.v === '[{"key":"q"}]', 'sync: a newer change wins, and each list is judged on its own', g.j);
r = await call('POST', '/api/sync', { token: A, body: { data: { carscout_tg: { v: 'secret', t: T.now }, carscout_push: { v: 'x', t: T.now }, evil: { v: 'x', t: T.now }, carscout_hunt: { v: 'y'.repeat(60001), t: T.now }, carscout_hist: { v: 'ok', t: 'soon' } } } });
check(r.j.ok && !('carscout_tg' in r.j.data) && !('carscout_push' in r.j.data) && !('evil' in r.j.data) && !('carscout_hunt' in r.j.data) && !('carscout_hist' in r.j.data), 'sync: only the five lists are stored; device settings (Telegram, phone alerts), unknown names, an oversized list and a bad time are ignored', Object.keys(r.j.data || {}));
r = await call('POST', '/api/sync', { token: A, body: { data: { carscout_insp: { v: '{}', t: T.now + 400 * DAY } } } });
check(r.j.data.carscout_insp.t <= T.now + DAY + 1, 'sync: a time far in the future is cut to one day ahead (a wrong phone clock cannot freeze a list)', r.j.data.carscout_insp);
r = await call('POST', '/api/sync', { token: A, raw: 'x'.repeat(400000) });
check(r.status === 413, 'sync: a huge request is refused (413)', r.status);
r = await call('POST', '/api/sync', { token: A, raw: 'not json' });
check(r.status === 400, 'sync: a broken request is refused (400)', r.status);

/* ---------- 4. another person ---------- */
const bob = await signIn({ sub: '2002', email: 'bob@example.com', name: 'Bob' });
r = await call('GET', '/api/sync', { token: bob.j.token });
check(bob.j.ok && JSON.stringify(r.j.data) === '{}' && n('SELECT COUNT(*) AS n FROM acct') === 2, 'accounts: another person sees none of the first one\'s lists', r.j);

/* ---------- 5. sign-out, delete, clean-up ---------- */
r = await call('POST', '/api/auth/logout', { token: A2, body: {} });
const after = await call('GET', '/api/sync', { token: A2 }), still = await call('GET', '/api/sync', { token: A });
check(r.j.ok && after.status === 401 && still.j.ok, 'sign-out: ends this session only, the other phone stays signed in', { after: after.status, still: still.status });
r = await call('POST', '/api/auth/delete', { token: A, body: {} });
const gone = await call('GET', '/api/sync', { token: A });
check(r.j.ok && gone.status === 401 && n("SELECT COUNT(*) AS n FROM acct WHERE uid = 'g:1001'") === 0 && n("SELECT COUNT(*) AS n FROM sess WHERE uid = 'g:1001'") === 0 && n("SELECT COUNT(*) AS n FROM acct WHERE uid = 'g:2002'") === 1, 'delete: the account and every session of it are removed from the server, nobody else is touched', { gone: gone.status });
T.now += 181 * DAY;
const old = await call('GET', '/api/sync', { token: bob.j.token });
check(old.status === 401, 'sessions expire after 180 days', old.status);
const cl = await W('dbCleanup(env, true)');
check(n('SELECT COUNT(*) AS n FROM sess') === 0 && cl.sess >= 1, 'the daily clean-up removes expired sessions', cl);

/* ---------- 6. the browser may send the session header, and the limits count these calls ---------- */
r = await W("(() => { const h = cors(env); return h['access-control-allow-headers']; })()");
check(/authorization/i.test(r), 'CORS: the page may send the Authorization header', r);
check(W("rlKind('POST', '/api/sync')") === 'write' && W("rlKind('POST', '/api/auth/google')") === 'write' && W("rlKind('GET', '/api/sync')") === 'read', 'request limits: signing in and saving lists use the write budget, reading uses the read budget', null);
finish();
