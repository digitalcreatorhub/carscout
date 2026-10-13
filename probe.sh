UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
V=2C4RC1BG0NR117203
: > out/v4.txt
for u in "https://en.bidfax.info/chrysler/pacifica/13035837-chrysler-pacifica-touring-l-2022-gray-36l-vin-2c4rc1bg0nr117203.html" "https://en.bidfax.info/index.php?do=search&subaction=search&story=$V" "https://bidfax.info/index.php?do=search&subaction=search&story=$V"; do
  curl -sL -m 25 -A "$UA" -H "Accept-Language: en" -H "Accept: text/html" -o out/v4.html -w "%{http_code} %{size_download} " "$u" >> out/v4.txt; echo "vin=$(grep -ci $V out/v4.html) cf=$(grep -c -i 'just a moment\|cf-chl\|captcha' out/v4.html) $u" >> out/v4.txt
done
