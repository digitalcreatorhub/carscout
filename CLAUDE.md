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
- Offline checks (.github/workflows/lifecheck.yml, Node 22, no network, on every push and pull request): lifecheck
  (time on sale), ratecheck (request limits of the worker), dbcheck (daily database clean-up), photocheck (the
  /api/photogen endpoint: a vision model picks the generation from two photos, with a fake AI), parsercheck (readers of
  ss.com, AutoScout24, autoplius, autoportaal, the generic reader, and the small helper functions). Run all five
  before changing worker/worker.js. The pages in parsercheck are built from what each reader looks for, not saved
  copies of live pages: when a site changes its markup and the daily selfcheck reports a reader failing, put the
  smallest piece of the failing page into a builder in tools/parsercheck.mjs and add the expected values.
- The worker limits requests per address (RL_LIMIT in worker.js, best effort, per server instance) and cleans old rows
  out of the database once a day from the cron (ss.com and VIN ads are kept a year, other ads 120 days). Change those
  numbers only together with ratecheck / dbcheck: the free D1 plan allows 100 000 rows written a day.
