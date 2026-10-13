UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/api/comps?source=as24&cy=D&make=Volkswagen&model=Golf&year=2018" > out/as24c.json
U=$(python3 -c "import json;j=json.load(open('out/as24c.json'));print(j['items'][0]['url'])")
U2=$(python3 -c "import json;j=json.load(open('out/as24c.json'));print(j['items'][5]['url'])")
echo "$U $U2" > out/as24urls.txt
curl -sL -A "$UA" -H "Accept-Language: de,en" "$U" -o out/as24ad.html -w "%{http_code} %{size_download}\n" >> out/as24urls.txt
curl -s -H "$O" "$W/api/listing?url=$U" > out/as24listing.json
curl -s -H "$O" "$W/api/listing?url=$U2" > out/as24listing2.json
curl -s -H "$O" "$W/api/listing?url=https://www.autoscout24.de/angebote/$(basename $U)" > out/as24listing_de.json
