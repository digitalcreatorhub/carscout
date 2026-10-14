sleep 40
curl -s "https://digitalcreatorhub.github.io/carscout/?nocache=$RANDOM" | grep -o 'data-goatcounter="[^"]*"\|2026-10-14\.1[0-9]' | sort -u > out/site.txt
curl -s -o /dev/null -w "count.js %{http_code}\n" https://gc.zgo.at/count.js >> out/site.txt
curl -s -o /dev/null -w "counter site %{http_code}\n" https://digitalcreatorhub.goatcounter.com/ >> out/site.txt
