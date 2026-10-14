UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
W=https://carscout.pmax70095.workers.dev
d(){ curl -s -H "Origin: https://digitalcreatorhub.github.io" "$W/api/debug?url=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$2")" > "out/w_$1.json"; }
d a24 "https://www.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&ae=2&af=50"
d a24rus "https://rus.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&ae=2&af=50"
g(){ curl -sL -A "$UA" -o "out/$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}\n" "$2" >> out/codes.txt; }
g oki "https://www.okidoki.ee/buy/1601/"
g oki2 "https://www.okidoki.ee/buy/1601/?query=volkswagen+golf"
g soov "https://soov.ee/32-soidukid/listings.html"
g ap "https://www.autoportaal.ee/"
