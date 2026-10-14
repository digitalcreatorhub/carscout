UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
g(){ curl -sL -A "$UA" -o "out/$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}\n" "$2" >> out/codes.txt; }
B="https://autoportaal.ee/et/kasutatud-autod"
g golf "$B?make=Volkswagen&model=Golf&year_min=2015&year_max=2020"
g golf2 "$B?make=Volkswagen&model=Golf&year_min=2015&year_max=2020&page=2"
g rav "$B?make=Toyota&model=RAV4"
g a6 "$B?make=Audi&model=A6"
g ad "https://autoportaal.ee/et/kasutatud-autod/27687"
g ru "https://autoportaal.ee/ru/kasutatud-autod?make=Volkswagen&model=Golf"
