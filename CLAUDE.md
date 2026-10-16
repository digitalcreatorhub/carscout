# CarScout: rules for anyone changing the app

- The users are in Latvia (Riga) and buy a car there. A link from another country means a person in Latvia
  looking at a car abroad: compare it first with its own country's market, show the Latvian price next to it,
  and keep everything else consistent with that (message to the seller in the seller's language, the import
  calculator with this car on the import side, history checks that work for a car not yet registered in Latvia).
- "Suspiciously cheap" and the scam price signal only with 8+ similar ads in the car's own country.
- Every verdict says what it was compared with (market, number of ads, typical price and range).
- Only free services. No CAPTCHA or anti-bot bypassing.
- Daily checks: .github/workflows/selfcheck.yml runs tools/selfcheck.mjs (real ads through the worker) and
  tools/logiccheck.mjs (fixed scenarios in the live app). Add a scenario there for every logic bug that is fixed.
- Time on sale ("how long such cars stay on ss.lv") is measured, never guessed: the worker cron re-checks ads and
  tools/lifecheck.mjs (Node 22, offline, runs on every push) tests it on a real SQLite database. Show a figure only
  when there are enough ads that left (8+, 6+ per price group); "left" means gone from the site, not necessarily sold.
