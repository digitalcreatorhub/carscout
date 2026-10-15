import fs from 'node:fs';
await new Promise(z=>setTimeout(z,200000));
const W='https://carscout.pmax70095.workers.dev', H={origin:'https://digitalcreatorhub.github.io'};
const C=[['ss','Land Rover','Range Rover Sport'],['ss','Mercedes-Benz','GLC'],['ss','Mercedes-Benz','CLA'],['ss','Škoda','Enyaq'],['ss','Volvo','XC40'],['ss','BMW','i4'],['ss','Mazda','6'],['autoportaal','BMW','5 Series'],['autoportaal','Mazda','Mazda6'],['autoportaal','Mercedes-Benz','E-Class'],['autoportaal','Mercedes-Benz','GLC'],['as24','Škoda','Enyaq iV'],['as24','Škoda','Enyaq'],['as24','BMW','5 Series'],['as24','Mercedes-Benz','E-Class']];
const out=[];
for(const [s,mk,md] of C){ const q=new URLSearchParams({source:s,make:mk,model:md,year:'2021'}); if(s==='as24') q.set('cy','D');
  try{ const j=await (await fetch(W+'/api/comps?'+q,{headers:H})).json(); out.push([s,mk,md,j.ok?(j.items||[]).length:'x:'+j.error,(j.items||[]).slice(0,3).map(i=>i.title).join(' / ').slice(0,120),j.searchUrl]); }catch(e){ out.push([s,mk,md,'err '+e]); }
  await new Promise(z=>setTimeout(z,1500)); }
fs.writeFileSync('out/pick_check.json',JSON.stringify(out));
