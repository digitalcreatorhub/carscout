sleep 45
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"
rm -f out/as24live.txt
for q in "make=Volkswagen&model=Golf&year=2018" "make=BMW&model=320&year=2017&fuel=diesel" "make=Tesla&model=Model%203&year=2021" "make=Toyota&model=RAV4&year=2020" "make=Audi&model=A6&year=2016&fuel=diesel"; do
  for cy in D B; do
  U=$(curl -s -H "$O" "$W/api/comps?source=as24&cy=$cy&$q" | python3 -c "import json,sys;j=json.load(sys.stdin);its=j.get('items') or [];print(its[min(2,len(its)-1)]['url'] if its else '')")
  [ -z "$U" ] && continue
  [ "$cy" = "D" ] && U=$(echo "$U" | sed 's#autoscout24.com/offers/#autoscout24.de/angebote/#')
  curl -s -H "$O" "$W/api/listing?url=$U" | python3 -c "
import json,sys;j=json.load(sys.stdin);l=j.get('listing') or {}
print(j.get('parser'), {k:l.get(k) for k in ['make','model','year','mileage_km','asking_price','fuel','gearbox','engine_l','power_kw','place','dealer','accident']}, 'carfax' if l.get('report_url') else '-', '$U'[-60:])" >> out/as24live.txt
  done
done
