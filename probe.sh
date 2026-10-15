sleep 70
W=https://carscout.pmax70095.workers.dev; O="Origin: https://digitalcreatorhub.github.io"; C=probeprobe0123456789
{
echo "== key"; curl -s -H "$O" $W/api/push/key; echo
echo "== key2"; curl -s -H "$O" $W/api/push/key; echo
echo "== badsub"; curl -s -H "$O" -X POST "$W/api/push/sub?code=$C" -d '{"sub":{"endpoint":"https://evil.example/x"}}'; echo
echo "== sub"; curl -s -H "$O" -X POST "$W/api/push/sub?code=$C" -d '{"sub":{"endpoint":"https://fcm.googleapis.com/fcm/send/fake-probe"},"lang":"ru","finds":[{"id":"probe1abc","p":{"make":"Škoda","models":["Superb"],"yf":2018,"pmax":20000,"mk":{"LV":1,"EE":1},"nobad":true}}]}'; echo
for i in 1 2 3; do echo "== tick $i"; curl -s -H "$O" $W/api/push/tick; echo; done
echo "== finds"; curl -s -H "$O" "$W/api/push/finds?code=$C" | head -c 600; echo
echo "== inbox"; curl -s -H "$O" -X POST $W/api/push/inbox -d '{"ep":"https://fcm.googleapis.com/fcm/send/fake-probe"}'; echo
echo "== off"; curl -s -H "$O" -X POST "$W/api/push/sub?code=$C" -d '{"off":true}'; echo
echo "== site"; curl -s https://digitalcreatorhub.github.io/carscout/ | grep -o "APP_VER = '[^']*'"; curl -s https://digitalcreatorhub.github.io/carscout/sw.js | grep -c "api/push/inbox"
} > out/push.txt 2>&1
