if [ -z "$TG_TOKEN" ]; then echo '{"token":"missing"}' > out/bot.json; else
curl -s "https://api.telegram.org/bot$TG_TOKEN/getMe" | python3 -c "import json,sys;j=json.load(sys.stdin);r=j.get('result') or {};print(json.dumps({'ok':j.get('ok'),'username':r.get('username'),'name':r.get('first_name'),'err':j.get('description')}))" > out/bot.json; fi
