curl -s "https://digitalcreatorhub.github.io/carscout/?r=$RANDOM" | grep -o "APP_VER='[^']*'\|id=\"lang-lv\"\|nav-find\|function lvT\|function kbFor" | sort | uniq -c > out/site.txt
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/api/seller?url=https://www.ss.lv/msg/lv/transport/cars/bmw/118/cchxpe.html" | python3 -c "import json,sys;j=json.load(sys.stdin);print(j.get('ok'),j.get('views'),j.get('carAds'),[ (i['title'][:30],i['km']) for i in j.get('items',[])[:3]])" >> out/site.txt
