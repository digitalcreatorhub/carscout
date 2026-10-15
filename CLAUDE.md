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
