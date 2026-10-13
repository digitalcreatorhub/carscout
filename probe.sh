UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"
U=https://www.ss.com/msg/en/transport/cars/volkswagen/arteon/cgppgl.html
curl -sL -c cj -b cj -A "$UA" $U -o out/ad.html
S=$(grep -o 'id="contacts_js" src="[^"]*"' out/ad.html | sed 's/.*src="//;s/"$//;s/&amp;/\&/g')
curl -sL -c cj -b cj -A "$UA" -e $U "https://www.ss.com$S" -o out/contacts.js
curl -sL -A "$UA" "https://www.ss.com/w_inc/js/main.en.ss.js?v=651" -o out/main.js
