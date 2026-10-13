UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
V=WBA8E1C58JA756430
rm -f out/vs_*; : > out/vsites.txt
f(){ curl -sL -m 25 -A "$UA" -H "Accept-Language: en" -o "out/vs_$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}" "$2"; echo " vinInPage=$(grep -c $V out/vs_$1.html) cf=$(grep -c -i 'just a moment\|cf-chl\|captcha' out/vs_$1.html)"; sleep 1; }
{
f vcit "https://vincheck.it.com/auctions/lot/47296956"
f vcit2 "https://vincheck.it.com/search?vin=$V"
f vcit3 "https://vincheck.it.com/vin/$V"
f vinfax "https://vinfax.net/vin/$V"
f vinfax2 "https://vinfax.net/search?q=$V"
f autoastat "https://autoastat.com/en/search?vin=$V"
f carfast "https://carfast.express/en/vin/$V"
f ccv "https://www.carcheckervin.com/vin/$V"
f plc "https://plc.auction/auction/vin/$V"
f autohelperbot "https://autohelperbot.com/en/vin/$V"
f bidcars2 "https://bid.cars/en/search/results?search-type=typing&query=$V"
f statvin "https://stat.vin/cars/$V"
f poctra "https://poctra.com/search?q=$V"
f salvagereseller "https://www.salvagereseller.com/search?query=$V"
f autobidcar "https://autobidcar.com/?s=$V"
} >> out/vsites.txt
