sleep 60
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/" > out/root.json
curl -s -H "$O" "$W/api/memory?make=Volkswagen&model=Golf&year=2018" > out/m0.json
curl -s -H "$O" "$W/api/comps?source=autoportaal&make=Volkswagen&model=Golf&year=2018" | head -c 200 > out/c.json
sleep 5
curl -s -H "$O" "$W/api/memory?make=Volkswagen&model=Golf&year=2018" > out/m1.json
U=$(curl -s -H "$O" "$W/api/comps?source=autoportaal&make=Volkswagen&model=Golf&year=2018" | python3 -c "import json,sys;print(json.load(sys.stdin)['items'][0]['url'])")
curl -s -H "$O" "$W/api/memory?url=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$U")" > out/m2.json
