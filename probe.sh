UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
curl -sL -A "$UA" -D out/del_h.txt "https://www.ss.lv/msg/lv/transport/cars/toyota/rav-4/zzqqzz.html" -o out/del.html
curl -sL -A "$UA" -D out/del2_h.txt "https://www.ss.com/msg/ru/transport/cars/toyota/rav-4/zzqqzz.html" -o out/del2.html
