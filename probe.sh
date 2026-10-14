W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/api/comps?source=autoportaal&make=Volkswagen&model=Golf&year=2018&fuel=petrol" > out/c1.json
curl -s -H "$O" "$W/api/comps?source=autoportaal&make=Toyota&model=RAV4&year=2019" > out/c2.json
curl -s -H "$O" "$W/api/comps?source=autoportaal&make=Mercedes-Benz&model=E-Class&year=2017" > out/c3.json
U=$(python3 -c "import json;print(json.load(open('out/c1.json'))['items'][0]['url'])")
curl -s -H "$O" "$W/api/listing?url=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$U")" > out/l1.json
