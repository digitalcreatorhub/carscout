UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
f(){ curl -sL -A "$UA" -H "Accept-Language: en,lv" -o "out/$1.html" -w "$1 %{http_code} %{size_download} %{url_effective}\n" "$2" >> out/svc.txt; sleep 1; }
rm -f out/svc.txt
f ltab "https://services.ltab.lv/lv/VehicleInsAndAcc"
f statvin "https://stat.vin/cars/5YJ3E1EA7KF317000"
f poctra "https://poctra.com/search?q=5YJ3E1EA7KF317000"
f bidcars "https://bid.cars/en/search/results?search-type=typing&query=5YJ3E1EA7KF317000"
f bidfaxinfo "https://bidfax.info/index.php?do=search&subaction=search&story=5YJ3E1EA7KF317000"
f nhtsa "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/5YJ3E1EA7KF317000?format=json"
f rdw "https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=G123BB"
for k in ltab statvin poctra bidcars bidfaxinfo; do echo "== $k" >> out/svc.txt; python3 - out/$k.html >> out/svc.txt <<'PY'
import re,sys
s=open(sys.argv[1],errors='ignore').read()
t=re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>',' ',s); t=re.sub('<[^>]+>',' ',t); t=re.sub(r'\s+',' ',t)
print(t[:600]); print('captcha' in s.lower(), 'cf-chl' in s or 'Just a moment' in s, [m for m in re.findall(r'<form[^>]*>',s)][:3], re.findall(r'<input[^>]+name="([^"]+)"',s)[:20])
PY
done
