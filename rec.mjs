import fs from 'node:fs';
const W='https://carscout.pmax70095.workers.dev', H={origin:'https://digitalcreatorhub.github.io'};
const P=['bmw/3-series-(all)','bmw/3-series','bmw/320','bmw/x5','bmw/i4','bmw/z4','bmw/m3','mercedes-benz/e-class-(all)','mercedes-benz/e-class','mercedes-benz/glc-class-(all)','mercedes-benz/glc','mercedes-benz/gl-class-(all)','mercedes-benz/eqe','skoda/enyaq-iv','skoda/enyaq','mazda/6','mazda/mazda6','mazda/cx-5','volvo/xc60','land-rover/range-rover-sport','toyota/rav4','toyota/rav-4','tesla/model-3','mini/cooper','mini/mini','hyundai/santa-fe','volkswagen/id.4','volkswagen/id-4','kia/ceed','kia/cee-d','citroen/c5-aircross','renault/megane','peugeot/e-208','byd/atto-3','mg/mg4'];
const out=[];
for(const p of P){ const u='https://www.autoscout24.com/lst/'+p+'?atype=C&cy=D&sort=standard&ustate=N%2CU';
  try{ const j=await (await fetch(W+'/api/debug?url='+encodeURIComponent(u),{headers:H})).json(); out.push([p,j.status,j.finalUrl,j.as24Articles,(j.sample||[]).map(s=>s.title).slice(0,2)]); }catch(e){ out.push([p,'err']); } }
const S=['ss.com/ru/transport/cars/land-rover/','ss.com/ru/transport/cars/rover/','ss.com/ru/transport/cars/land-rover/range-rover-sport/'];
for(const s of S){ try{ const j=await (await fetch(W+'/api/debug?url='+encodeURIComponent('https://www.'+s),{headers:H})).json(); out.push([s,j.status,j.finalUrl,j.ssRows]); }catch(e){ out.push([s,'err']); } }
fs.writeFileSync('out/as24_slugs.json',JSON.stringify(out));
