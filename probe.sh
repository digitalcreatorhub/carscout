UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
W=https://carscout.pmax70095.workers.dev
g(){ curl -sL -A "$UA" -o "out/$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}\n" "$2" >> out/codes.txt; }
g list "https://autoportaal.ee/et/kasutatud-autod"
g vw "https://autoportaal.ee/et/kasutatud-autod/volkswagen"
g golf "https://autoportaal.ee/et/kasutatud-autod/volkswagen/golf"
g marks "https://autoportaal.ee/et/populaarsed-automargid"
