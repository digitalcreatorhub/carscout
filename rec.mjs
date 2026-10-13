import { chromium } from 'playwright';
import fs from 'node:fs';
const W='https://carscout.pmax70095.workers.dev', O={origin:'https://digitalcreatorhub.github.io'};
const list=await (await fetch(W+'/api/search?url='+encodeURIComponent('https://www.ss.com/ru/transport/cars/bmw/'),{headers:O})).json();
const ad=(list.items||[]).find(i=>/\/msg\//.test(i.url)&&i.km);
const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1400,height:900}});
await pg.goto('https://digitalcreatorhub.github.io/carscout/?r='+Date.now()); await pg.waitForTimeout(2000); await pg.click('#lang-ru');
await pg.fill('#f-url',ad.url); await pg.click('#btn-go'); await pg.waitForSelector('#a-check',{timeout:90000});
await pg.waitForTimeout(3000);
await pg.fill('#c-vin','WBA8E1C53JA159590'); await pg.click('[data-act=recheck]');
await pg.waitForSelector('.accb',{timeout:90000}).catch(()=>{});
await pg.waitForTimeout(5000);
const out={ver:await pg.evaluate(()=>document.documentElement.innerHTML.match(/APP_VER='([^']+)'/)?.[1]), url:ad.url, banner:await pg.$eval('.accb',e=>e.innerText).catch(()=>'NONE'), panel:await pg.$eval('#a-acc',e=>e.innerText.slice(0,500)).catch(()=>'NONE'), imgs:await pg.$$eval('#a-acc .accph img',a=>a.filter(i=>i.complete&&i.naturalWidth>0).length).catch(()=>0)};
const car=await pg.$('#a-car'); if(car) await car.screenshot({path:'out/live_acc_car.png'});
const ac=await pg.$('#a-acc'); if(ac){ await ac.scrollIntoViewIfNeeded(); await pg.waitForTimeout(2500); await ac.screenshot({path:'out/live_acc_panel.png'}); }
fs.writeFileSync('out/live_acc.json',JSON.stringify(out,null,1)); await b.close();
