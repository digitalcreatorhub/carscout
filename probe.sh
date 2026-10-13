W=https://carscout.pmax70095.workers.dev
O="Origin: https://digitalcreatorhub.github.io"
sleep 30
for u in https://www.ss.lv/msg/lv/transport/cars/bmw/118/cchxpe.html https://www.ss.com/msg/en/transport/cars/volkswagen/arteon/cgppgl.html; do
  curl -s -H "$O" "$W/api/seller?url=$u" | head -c 1500 >> out/w_seller.txt; echo >> out/w_seller.txt
  curl -s -H "$O" "$W/api/listing?url=$u" | python3 -c "import json,sys;j=json.load(sys.stdin);l=j.get('listing',{});print(j.get('ok'),j.get('error'),{k:l.get(k) for k in ['make','model','year','posted','updated','ss_id','removed','asking_price']})" >> out/w_seller.txt
done
curl -s -H "$O" "$W/api/listing?url=https://www.ss.lv/msg/lv/transport/cars/toyota/rav-4/zzqqzz.html" | head -c 300 >> out/w_seller.txt
