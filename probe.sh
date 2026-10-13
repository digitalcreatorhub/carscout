UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
H=(-H "Accept-Language: lv,en" -H "Accept: */*" -H "Sec-Fetch-Dest: script" -H "Sec-Fetch-Mode: no-cors" -H "Sec-Fetch-Site: same-origin")
curl -sL -A "$UA" https://www.ss.lv/lv/transport/cars/bmw/ -o out/list.html
grep -o 'href="/msg/lv/transport/cars/bmw/[^"]*\.html"' out/list.html | sed 's/href="//;s/"//' | sort -u | head -20 > out/ads.txt
got=0; rm -f out/stats.txt
while read p; do
  U="https://www.ss.lv$p"; rm -f cj
  curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" $U -o a.html
  S=$(grep -o 'id="contacts_js" src="[^"]*"' a.html | sed 's/.*src="//;s/"$//;s/&amp;/\&/g')
  R=$(curl -sL -c cj -b cj -A "$UA" "${H[@]}" -e $U "https://www.ss.lv$S" | head -c 120 | tr '\n' ' ')
  [ -z "$R" ] && { sleep 1; R=$(curl -sL -c cj -b cj -A "$UA" "${H[@]}" -e $U "https://www.ss.lv$S" | head -c 120 | tr '\n' ' '); R="retry:$R"; }
  echo "$p | $R" >> out/stats.txt
  T=$(echo "$R" | grep -o 'OPEN_STAT_LNK="[^"]*"' | sed 's/.*="//;s/"//')
  C=$(echo "$R" | grep -o 'ADS_STAT=\[[0-9]*' | sed 's/.*\[//')
  if [ "$got" = 0 ] && [ "${C:-0}" -gt 0 ]; then got=1; curl -sL -b cj -A "$UA" -H "Accept-Language: lv,en" -e $U "https://www.ss.lv/lv/search-result/?t=$T" -o out/sr.html; echo "$p $T" > out/sr.txt; fi
done < out/ads.txt
