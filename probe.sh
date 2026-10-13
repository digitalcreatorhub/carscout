UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
rm -f out/cf_*
i=0
for q in "make=BMW&model=320&year=2017&fuel=diesel" "make=Volkswagen&model=Golf&year=2018" "make=Audi&model=A6&year=2016"; do
  for k in 0 3; do i=$((i+1))
  U=$(curl -s -H "$O" "$W/api/comps?source=as24&cy=D&$q" | python3 -c "import json,sys;j=json.load(sys.stdin);its=j.get('items') or [];print(its[$k]['url'] if len(its)>$k else '')")
  R=$(curl -s -H "$O" "$W/api/listing?url=$U" | python3 -c "import json,sys;j=json.load(sys.stdin);print((j.get('listing') or {}).get('report_url') or '')")
  echo "$i $U $R" >> out/cf_urls.txt
  [ -n "$R" ] && curl -sL -A "$UA" -H "Accept-Language: en,de" "$R" -o out/cf_$i.html -w "  -> %{http_code} %{size_download} %{url_effective}\n" >> out/cf_urls.txt
  done
done
