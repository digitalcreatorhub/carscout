UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
curl -sL -A "$UA" https://www.ss.lv/lv/transport/cars/toyota/ -o out/list.html
grep -o 'href="/msg/lv/transport/cars/toyota/[^"]*\.html"' out/list.html | sed 's/href="//;s/"//' | awk '!s[$0]++' | head -25 > out/ads.txt
rm -f out/dates.txt
while read p; do
  curl -sL -A "$UA" "https://www.ss.lv$p" -o a.html
  echo "$p | $(grep -o 'Datums: [^<]*' a.html) | $(grep -o '/js/lv/[0-9-]*/' a.html) | $(grep -o 'ad_id=[0-9]*\|value=.[0-9]*_[0-9]*' a.html | head -1)" >> out/dates.txt
done < out/ads.txt
