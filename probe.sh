UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
i=0
for T in EFsTElobF1M= EFsSFVAWHFM= EFsSFVcbFVs= EFsSFVcbFFM=; do i=$((i+1))
curl -sL -A "$UA" -H "Accept-Language: lv,en" -e "https://www.ss.lv/msg/lv/transport/cars/bmw/318/bkonjc.html" "https://www.ss.lv/lv/search-result/?t=$T" -D out/srh$i.txt -o out/sr$i.html; sleep 1
done
