import { chromium } from 'playwright';
import fs from 'node:fs';
await new Promise(r=>setTimeout(r,60000));
const b=await chromium.launch(); const out=[];
for(const [n,u] of ['https://www.ss.com/msg/ru/transport/cars/audi/a6/gchix.html','https://www.ss.com/msg/ru/transport/cars/audi/a6/cfcnpl.html'].entries()){
  const pg=await b.newPage({viewport:{width:1400,height:900}});
  await pg.goto('https://digitalcreatorhub.github.io/carscout/?r='+Date.now()); await pg.waitForTimeout(2000);
  await pg.click('#lang-ru'); await pg.fill('#f-url',u); await pg.click('#btn-go');
  await pg.waitForSelector('#a-verdict',{timeout:90000}).catch(()=>{});
  await pg.waitForFunction(()=>{const v=window.__carscout&&window.__carscout.S.view; return v&&v.photoState==='ok';},null,{timeout:90000}).catch(()=>{});
  await pg.waitForTimeout(3000);
  out.push(await pg.evaluate(()=>({ver:document.documentElement.innerHTML.match(/APP_VER='([^']+)'/)?.[1],sub:document.querySelector('#a-car .sub')?.textContent,weak:document.querySelector('#a-weak')?.innerText.slice(0,300),map:document.querySelector('.mapi')?.innerText,flags:document.querySelector('#a-life .ls')?.innerText})));
  const el=await pg.$('#a-life'); if(el) await el.screenshot({path:'out/life2_'+n+'.png'});
  await pg.close(); }
fs.writeFileSync('out/a6b.json',JSON.stringify(out,null,1)); await b.close();
