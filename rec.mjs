import fs from 'node:fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get=async u=>{ try{ const r=await fetch(u,{headers:{'user-agent':UA}}); return await r.text(); }catch(e){ return 'ERR '+e; } };
const o={};
for(const [k,u] of [['bmw','https://autoportaal.ee/et/kasutatud-autod?make=BMW'],['bmw5','https://autoportaal.ee/et/kasutatud-autod?make=BMW&model=5%20seeria'],['merc','https://autoportaal.ee/et/kasutatud-autod?make=Mercedes-Benz'],['home','https://autoportaal.ee/et/kasutatud-autod']]){
  const h=await get(u); o[k]={len:h.length, models:[...new Set((h.match(/model[^"'<>]{0,40}["'][^"'<>]{0,60}/gi)||[]))].slice(0,80), opts:(h.match(/<option[^>]*>[^<]{0,40}<\/option>/g)||[]).slice(0,200), scripts:(h.match(/"models?"\s*:\s*\[[^\]]{0,3000}\]/g)||[]).slice(0,5), apis:[...new Set(h.match(/\/api\/[a-z0-9\/_\-?=&]+/gi)||[])].slice(0,40)};
}
fs.writeFileSync('out/ap_models.json',JSON.stringify(o,null,1));
