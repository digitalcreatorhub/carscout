UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
curl -sL -A "$UA" https://www.ss.lv/lv/transport/cars/audi/ -o list.html
grep -o 'href="/msg/lv/transport/cars/audi/[^"]*\.html"' list.html | sed 's/href="//;s/"//' | awk '!s[$0]++' | head -6 > ads.txt
rm -f out/vin.txt
while read p; do
  U="https://www.ss.lv$p"; rm -f cj
  curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" "$U" -o a.html
  D=$(grep -o "_show_js_special_data( '[^']*'" a.html | head -1 | sed "s/.*( '//;s/'$//")
  if [ -z "$D" ]; then echo "$p | no vin button" >> out/vin.txt; continue; fi
  R=$(curl -s -c cj -b cj -A "$UA" -H "Accept: message/x-ajax" -H "Accept-Language: lv,en" -H "X-Requested-With: XMLHttpRequest" -e "$U" "https://www.ss.lv/w_inc/ajax.php?action=show_special_js_data&version=1&lg=lv&data=$D" | head -c 300)
  echo "$p | $R" >> out/vin.txt; sleep 2
done < ads.txt
