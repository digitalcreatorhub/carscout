UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
curl -sL -A "$UA" https://www.ss.lv/lv/transport/cars/volkswagen/ -o out/list.html
grep -o 'href="/msg/lv/transport/cars/volkswagen/[^"]*\.html"' out/list.html | sed 's/href="//;s/"//' | sort -u | head -12 > out/ads.txt
got=0
while read p; do
  U="https://www.ss.lv$p"; rm -f cj; sleep 2
  curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" $U -o a.html
  S=$(grep -o 'id="contacts_js" src="[^"]*"' a.html | sed 's/.*src="//;s/"$//;s/&amp;/\&/g')
  R=$(curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" -H "Accept: */*" -H "Sec-Fetch-Dest: script" -H "Sec-Fetch-Mode: no-cors" -H "Sec-Fetch-Site: same-origin" -e $U "https://www.ss.lv$S" | head -c 200 | tr '\n' ' ')
  echo "$p | S=${S:0:60} | $(wc -c < a.html) | $R" >> out/stats.txt
  T=$(echo "$R" | grep -o 'OPEN_STAT_LNK="[^"]*"' | sed 's/.*="//;s/"//')
  C=$(echo "$R" | grep -o 'ADS_STAT=\[[0-9]*' | sed 's/.*\[//')
  if [ "$got" = 0 ] && [ "${C:-0}" -gt 1 ]; then got=1; curl -sL -A "$UA" -e $U "https://www.ss.lv/lv/search-result/?t=$T" -o out/sr.html; echo "$p $T" > out/sr.txt; fi
done < out/ads.txt
