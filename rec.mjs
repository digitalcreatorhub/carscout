import fs from 'node:fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get=async u=>{ for(let i=0;i<3;i++){ try{ const r=await fetch(u,{headers:{'user-agent':UA,'accept-language':'ru'}}); return await r.text(); }catch(e){ await new Promise(z=>setTimeout(z,1500)); } } return ''; };
const strip=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim();
const base='https://www.ss.com/ru/transport/cars/';
const h=await get(base); const makes=[]; const re=/<a[^>]+href="\/ru\/transport\/cars\/([a-z0-9\-]+)\/"[^>]*>([\s\S]*?)<\/a>/g; let m;
while((m=re.exec(h))){ const t=strip(m[2]); if(t&&!makes.find(x=>x.slug===m[1])) makes.push({slug:m[1],name:t}); }
const out={};
for(const mk of makes){ const p=await get(base+mk.slug+'/'); const r2=new RegExp('<a[^>]+href="/ru/transport/cars/'+mk.slug+'/([a-z0-9\\-]+)/"[^>]*>([\\s\\S]*?)</a>','g'); const md=[]; let x;
  while((x=r2.exec(p))){ const t=strip(x[2]); if(t&&!md.find(y=>y[0]===x[1])) md.push([x[1],t]); }
  out[mk.slug]={name:mk.name,models:md}; await new Promise(z=>setTimeout(z,300)); }
fs.writeFileSync('out/ss_models.json',JSON.stringify({makes,out}));
console.log(makes.length);
