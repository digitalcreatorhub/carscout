import fs from 'node:fs';
const W='https://carscout.pmax70095.workers.dev', O={origin:'https://digitalcreatorhub.github.io'};
const out={};
for(const u of ['https://www.ss.com/msg/ru/transport/cars/audi/a6/gchix.html','https://www.ss.com/msg/ru/transport/cars/audi/a6/cfcnpl.html']) out[u]=await (await fetch(W+'/api/listing?url='+encodeURIComponent(u),{headers:O})).json();
const h=await (await fetch('https://digitalcreatorhub.github.io/carscout/?r='+Date.now())).text();
out.liveHasSoftm=h.includes('softm'); out.ver=(h.match(/APP_VER='([^']+)'/)||[])[1];
fs.writeFileSync('out/a6.json',JSON.stringify(out,null,1));
