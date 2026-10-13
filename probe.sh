UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
for u in https://www.ss.com/msg/en/transport/cars/toyota/c-hr/cbbpnk.html https://www.ss.lv/msg/lv/transport/cars/toyota/c-hr/cbbpnk.html https://www.ss.com/msg/ru/transport/cars/audi/a3/olkkg.html https://www.ss.lv/msg/lv/transport/cars/audi/a3/olkkg.html https://www.ss.com/msg/ru/transport/cars/skoda/roomster/bgogn.html https://www.ss.lv/msg/lv/transport/cars/rover/range-rover/cgoneh.html; do
  f=out/p_$(echo $u | md5sum | cut -c1-6).html; curl -sL -A "$UA" "$u" -o $f; echo "$u $f" >> out/pmap.txt; sleep 1
done
curl -sL -A "$UA" "https://www.ss.com/ru/transport/cars/volkswagen/" -o out/vwcat.html
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/api/comps?source=autoplius&make=Volkswagen&model=Golf&year=2018" | head -c 600 > out/apl.json
curl -s -H "$O" "$W/api/debug?url=https://en.autoplius.lt/ads/used-cars/volkswagen/golf" | head -c 1500 > out/apl_dbg.json
