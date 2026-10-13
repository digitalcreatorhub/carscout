UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
for p in /msg/lv/transport/cars/volkswagen/arteon/cgoonl.html /msg/lv/transport/cars/volkswagen/caddy/ccjgbj.html; do
  U="https://www.ss.lv$p"; rm -f cj
  curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" $U -o a.html
  S=$(grep -o 'id="contacts_js" src="[^"]*"' a.html | sed 's/.*src="//;s/"$//;s/&amp;/\&/g')
  echo "== $p $S" >> out/dbg.txt
  curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" -H "Accept: */*" -H "Sec-Fetch-Dest: script" -H "Sec-Fetch-Mode: no-cors" -H "Sec-Fetch-Site: same-origin" -e $U "https://www.ss.lv$S" -D - >> out/dbg.txt
  echo >> out/dbg.txt; cat cj >> out/dbg.txt
done
