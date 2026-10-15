import fs from 'node:fs';
let src=fs.readFileSync('wk.js','utf8').replace('export default','const __default =')+'\nexport {__default,parseApList};';
fs.writeFileSync('wk_m.mjs',src); const W=await import('./wk_m.mjs');
const u='https://autoportaal.ee/et/kasutatud-autod?make=BMW&year_min=2018&year_max=2020';
const r=await (await fetch(u,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}})).text();
const it=W.parseApList(r);
const res=await W.__default.fetch(new Request('https://w.example/api/comps?source=autoportaal&make=BMW&model=5%20Series&year=2019'),{});
const j=await res.json();
fs.writeFileSync('out/ap_bmw2.json',JSON.stringify({n:it.length, items:it.slice(0,12).map(i=>[i.make,i.model,i.year,i.title]), comps:{ok:j.ok,err:j.error,n:(j.items||[]).length,url:j.searchUrl}}));
