UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
U=https://www.ss.lv/msg/lv/transport/cars/volkswagen/arteon/cgoonl.html
curl -sL -c cj -b cj -A "$UA" -H "Accept-Language: lv,en" $U -o out/ad2.html
S=$(grep -o 'id="contacts_js" src="[^"]*"' out/ad2.html | sed 's/.*src="//;s/"$//;s/&amp;/\&/g')
curl -sL -c cj -b cj -A "$UA" -H "Accept: */*" -H "Sec-Fetch-Dest: script" -H "Sec-Fetch-Mode: no-cors" -H "Sec-Fetch-Site: same-origin" -e $U "https://www.ss.lv$S" -D out/hdr.txt -o out/contacts.js
cat cj > out/cj.txt
