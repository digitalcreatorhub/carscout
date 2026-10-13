UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"
U=https://www.ss.com/msg/en/transport/cars/volkswagen/arteon/cgppgl.html
curl -sL -c cj -b cj -A "$UA" $U -o out/ad.html
C=$(grep -o 'src="/w_inc/chk.php[^"]*"' out/ad.html | sed 's/src="//;s/"$//;s/&amp;/\&/g')
curl -sL -c cj -b cj -A "$UA" -e $U "https://www.ss.com$C" -o out/chk.js
U2=https://www.ss.lv/msg/lv/transport/cars/volkswagen/arteon/cgoonl.html
curl -sL -A "$UA" $U2 -o out/ad2.html
C2=$(grep -o 'src="/w_inc/chk.php[^"]*"' out/ad2.html | sed 's/src="//;s/"$//;s/&amp;/\&/g')
curl -sL -A "$UA" -e $U2 "https://www.ss.lv$C2" -o out/chk2.js
echo "$C | $C2" > out/chkurl.txt
