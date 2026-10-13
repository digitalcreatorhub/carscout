import { chromium } from 'playwright';
import fs from 'node:fs';
await new Promise(r=>setTimeout(r,50000));
const W='https://carscout.pmax70095.workers.dev', O={origin:'https://digitalcreatorhub.github.io'};
const list=await (await fetch(W+'/api/search?url='+encodeURIComponent('https://www.ss.com/ru/transport/cars/audi/a6/'),{headers:O})).json();
const ads=(list.items||[]).filter(i=>/\/msg\//.test(i.url)&&i.km);
const pick=[ads.find(i=>/3[.,]0/.test(i.title)&&i.fuel==='diesel')||ads[0], ads[3]];
const b=await chromium.launch(); const out=[];
for(const [n,ad] of pick.entries()){
  const pg=await b.newPage({viewport:{width:1400,height:900}});
  await pg.goto('https://digitalcreatorhub.github.io/carscout/?r='+Date.now()); await pg.waitForTimeout(2000);
  await pg.click('#lang-ru'); await pg.fill('#f-url',ad.url); await pg.click('#btn-go');
  await pg.waitForSelector('#a-verdict',{timeout:90000}).catch(()=>{});
  await pg.waitForFunction(()=>{const v=window.__carscout&&window.__carscout.S.view; return v&&v.photoState==='ok';},null,{timeout:90000}).catch(()=>{});
  await pg.waitForTimeout(4000);
  const info=await pg.evaluate(()=>{ const c=window.__carscout.S.view.car; return {sub:document.querySelector('#a-car .sub')?.textContent, place:c.place, address:c.address, geo:c.geo, weak:document.querySelector('#a-weak')?.innerText.slice(0,500), map:!!document.querySelector('.mapf'), maptext:document.querySelector('.mapi')?.innerText}; });
  info.url=ad.url; out.push(info);
  const el=await pg.$('#a-life'); if(el) await el.screenshot({path:'out/life_'+n+'.png'});
  const ca=await pg.$('#a-car'); if(ca) await ca.screenshot({path:'out/car_'+n+'.png'});
  await pg.close();
}
fs.writeFileSync('out/map_audit.json',JSON.stringify(out,null,1)); await b.close();
