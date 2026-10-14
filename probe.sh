UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
g(){ curl -sL -A "$UA" -H 'Accept-Language: et,en;q=0.8' -o "out/$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}\n" "$2" >> out/codes.txt; }
g home "https://www.auto24.ee/"
g list1 "https://www.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&ae=2&af=50&otsi=otsi"
g list2 "https://www.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&b=4&ae=2&af=50"
g rus "https://rus.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&ae=2&af=50"
g eng "https://eng.auto24.ee/kasutatud/nimekiri.php?bn=2&a=100&ae=2&af=50"
g search "https://www.auto24.ee/kasutatud/otsing.php"
