UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
U="https://en.autoplius.lt/ads/used-cars/volkswagen/golf?make_date_from=2017&make_date_to=2019"
curl -s -o /dev/null -w "runner plain: %{http_code}\n" -A "$UA" "$U" > out/apl2.txt
curl -s -o /dev/null -w "runner full headers: %{http_code}\n" -A "$UA" -H "accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" -H "accept-language: en-US,en;q=0.9,lv;q=0.8" "$U" >> out/apl2.txt
curl -s -o /dev/null -w "runner lt host: %{http_code}\n" -A "$UA" "https://autoplius.lt/skelbimai/naudoti-automobiliai/volkswagen/golf" >> out/apl2.txt
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
for i in 1 2 3; do curl -s -H "$O" "$W/api/comps?source=autoplius&make=Toyota&model=Corolla&year=201$i" | head -c 120 >> out/apl2.txt; echo >> out/apl2.txt; sleep 5; done
