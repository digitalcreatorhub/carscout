import { chromium } from 'playwright';
import fs from 'node:fs';
await new Promise(r=>setTimeout(r,60000));
const W='https://carscout.pmax70095.workers.dev', O={origin:'https://digitalcreatorhub.github.io'};
const list=await (await fetch(W+'/api/search?url='+encodeURIComponent('https://www.ss.com/ru/transport/cars/toyota/'),{headers:O})).json();
const ad=(list.items||[]).find(i=>/\/msg\//.test(i.url)&&i.km);
const url=ad.url.replace('/msg/ru/','/msg/en/');
const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1400,height:900}});
await pg.goto('https://digitalcreatorhub.github.io/carscout/?r='+Date.now()); await pg.waitForTimeout(2500);
await pg.click('#lang-ru'); await pg.fill('#f-url',url); await pg.click('#btn-go');
await pg.waitForSelector('#a-verdict',{timeout:90000}).catch(()=>{});
await pg.waitForFunction(()=>{const v=window.__carscout&&window.__carscout.S.view; return v&&v.photoState==='ok';},null,{timeout:90000}).catch(()=>{});
const res={url,ver:await pg.evaluate(()=>document.documentElement.innerHTML.match(/APP_VER='([^']+)'/)?.[1])};
for(const l of ['en','lv','ru']){ await pg.click('#lang-'+l); await pg.waitForTimeout(500);
  for(const n of ['nav-find','nav-insp']){ await pg.click('.rail [data-act='+n+']'); await pg.waitForTimeout(200); }
  const t=await pg.evaluate(()=>document.body.innerText);
  const lines=t.split('\n').map(s=>s.trim()).filter(Boolean);
  res[l]={cyr:l==='ru'?[]:lines.filter(s=>/[А-Яа-яЁё]{2,}/.test(s)&&!/^Русский$/.test(s)).slice(0,15), foot:lines.filter(s=>/2026-10-13/.test(s)).slice(0,2), head:await pg.$eval('.lead',e=>getComputedStyle(e,'::before').content)};
  await pg.screenshot({path:'out/live_'+l+'.png'}); }
res.car=await pg.evaluate(()=>{const c=window.__carscout.S.view.car; return [c.make,c.model,c.year,c.km,c.price,c.fuel,c.gear].join(' | ');});
fs.writeFileSync('out/live_audit.json',JSON.stringify(res,null,1)); await b.close();
