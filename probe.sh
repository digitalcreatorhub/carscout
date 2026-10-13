UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
V=2C4RC1BG0NR117203
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
curl -s -H "$O" "$W/api/vinhist?vin=$V" > out/v2.json
curl -sL -A "$UA" "https://vincheck.it.com/vin/$V" -o out/v2_vc.html -w "vc %{http_code} %{size_download} %{url_effective}\n" > out/v2.txt
grep -o "$V" out/v2_vc.html | head -1 >> out/v2.txt
