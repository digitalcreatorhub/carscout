import fs from 'node:fs';
const W='https://carscout.pmax70095.workers.dev', H={origin:'https://digitalcreatorhub.github.io'};
const C=[['BMW','5 Series'],['BMW','520'],['BMW','X5'],['BMW','3 Series'],['Mercedes-Benz','E-Class'],['Mercedes-Benz','E 220'],['Mercedes-Benz','C-Class'],['Mercedes-Benz','GLC'],['Mercedes-Benz','GLC-Class'],['Mazda','Mazda6'],['Mazda','6'],['Mazda','CX-5'],['Land Rover','Range Rover Sport'],['Land Rover','Discovery'],['Toyota','RAV4'],['Toyota','RAV 4'],['Volkswagen','Passat'],['Tesla','Model 3'],['Hyundai','Santa Fe'],['Škoda','Enyaq'],['Škoda','Enyaq iV'],['Volvo','XC60'],['Volvo','XC 60'],['Honda','CR-V'],['Kia','Ceed'],['Citroën','C5 Aircross'],['Mini','Cooper'],['Lexus','RX']];
const S=[['ss',''],['autoplius',''],['autoportaal',''],['as24','D']];
const out=[];
await Promise.all(C.map(async([mk,md])=>{ const row={mk,md};
  for(const [s,cy] of S){ const q=new URLSearchParams({source:s,make:mk,model:md,year:'2018'}); if(cy) q.set('cy',cy);
    try{ const r=await fetch(W+'/api/comps?'+q,{headers:H}); const j=await r.json(); row[s]=j.ok?(j.items||[]).length:('x:'+j.error); row[s+'_u']=j.searchUrl||''; }catch(e){ row[s]='err'; } }
  out.push(row); }));
fs.writeFileSync('out/models_check.json',JSON.stringify(out,null,0));
