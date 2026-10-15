import fs from 'node:fs';
const W='https://carscout.pmax70095.workers.dev', H={origin:'https://digitalcreatorhub.github.io'};
const u='https://autoportaal.ee/et/kasutatud-autod?make=BMW&year_min=2018&year_max=2020';
const j=await (await fetch(W+'/api/debug?url='+encodeURIComponent(u)+'&find=%22model%22&len=3000',{headers:H})).json();
const r=await (await fetch(u,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}})).text();
fs.writeFileSync('out/ap_bmw.json',JSON.stringify({around:j.around, models:[...r.matchAll(/"model"\s*:\s*"([^"]+)"/g)].map(m=>m[1]).slice(0,60), len:r.length}));
