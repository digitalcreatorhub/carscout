sleep 50
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
: > out/vh.txt
for v in WBA8E1C58JA756430 WBA8E1C53JA159590 WVWZZZ3CZLE012345 1HGCM82633A004352 5YJ3E1EA7KF317000; do
  curl -s -H "$O" "$W/api/vinhist?vin=$v" | head -c 700 >> out/vh.txt; echo >> out/vh.txt
done
P=$(curl -s -H "$O" "$W/api/vinhist?vin=WBA8E1C58JA756430" | python3 -c "import json,sys;print(json.load(sys.stdin)['lots'][0]['photos'][0])")
curl -s -H "$O" -o /dev/null -w "img %{http_code} %{content_type} %{size_download}\n" "$W/api/img?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$P',safe=''))")" >> out/vh.txt
