# Hosting på Cloudflare

Oslo-buss køyrer som ein Cloudflare Worker utan tenar å vedlikehalde.

| Del | Kor | Kostnad |
|---|---|---|
| Sida (`dist/`) og kartflisene | Worker static assets | Gratis og ubegrensa, køyrer ingen kode |
| `/feeds/buses` og `/data/timetable.json` | Worker → ein Durable Object (`Feeds`) | Sjå under |
| `/feeds/weather` | Worker, mellomlagra i 30 min (Cache API) | Ubetydeleg: ein førespurnad til MET kvar halvtime |
| Dagleg tidstabell | GitHub Action → grenen `data` i dette repoet | Gratis |

## Korleis det heng saman

- **Éin Durable Object for alle.** Alle førespurnader til `/feeds/buses` og `/data/timetable.json` går til same objekt
  (`idFromName('main')`). Det er det som gjer at Entur ser éin førespurnad kvart 15. sekund uansett kor mange som ser på, og
  berre medan nokon spør.
- **Tidstabellen** hentar objektet frå `TIMETABLE_URL` (`wrangler.jsonc`, grenen `data`). Han blir lagra gzippa i objektet sitt
  eige lager (`src/worker/pack.ts`), så ein kaldstart etter utkasting ikkje må laste han ned igjen. Kvar halvtime blir GitHub
  spurt med `If-None-Match` (ETag): eit tomt 304-svar om ingenting er nytt, elles blir kopien bytt ut. Objektet held siste gode
  kopi om GitHub ikkje svarar. Nettlesaren får tidstabellen frå `/data/timetable.json`, slik at han alltid er den same som
  relayen bruker.
- **Vêret** (`/feeds/weather`, `src/worker/weather.ts`) går ikkje via objektet. Workeren hentar frå MET Norway sitt
  locationforecast-API med `User-Agent: slish-oslo-buss github.com/slish/oslo-buss` (MET krev namn på appen og kontaktinfo),
  reduserer svaret til nokre tal og mellomlagrar det i 30 minutt med Cache API. Vilkåra krev kreditering, som står i botnen av sida.
- **Kartflisene** blir henta frå grenen `tiles` av deploy-flyten og følgjer med bygget som vanlege filer. `public/.assetsignore` held
  ein lokal `timetable.json` ute av opplastinga: Worker-en svarar på den stien.

## Første gong

1. Logg inn (opnar nettlesaren, du godkjenner sjølv):

   ```bash
   npx wrangler login
   ```

2. Publiser (byggjer sida og lastar opp Worker og Durable Object):

   ```bash
   npm run deploy
   ```

   Wrangler skriv ut adressa. Den første publiseringa gav `https://oslo-buss.oslo-buss.workers.dev`. Ei ny `workers.dev`-adresse kan
   gi TLS-feil i nokre minutt før sertifikatet er klart.

3. Sjekk at det lever: opne adressa, eller `curl https://oslo-buss.<konto>.workers.dev/feeds/buses`.

Lokal prøve av heile oppsettet utan konto: `npm run build && npm run worker`, og opne `http://127.0.0.1:8787`.

## Automatisk publisering

`.github/workflows/deploy.yml` køyrer typesjekk, testar og bygg ved kvar push til `main` og publiserer så med `wrangler deploy`.
Endringar som berre rører dokumentasjon blir hoppa over. Han treng to hemmelegheiter i repoet, og utan dei blir
sjekkane køyrde utan å publisere:

1. **`CLOUDFLARE_API_TOKEN`:** Lag eit token i Cloudflare (My Profile → API Tokens → Create Token → malen
   «Edit Cloudflare Workers», avgrensa til kontoen din), og legg det inn utan å lime det inn i chat eller i filer:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   ```

   Du blir beden om verdien i terminalen.
2. **`CLOUDFLARE_ACCOUNT_ID`:** Kontonummeret (står under Workers & Pages i dashbordet eller i `npx wrangler whoami`):

   ```bash
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

Test med Actions → Publiser → Run workflow. Eit token som blir lekka kan publisere kva som helst til kontoen din: lag det
med så smale rettar som mogleg, og slett det i Cloudflare om du er i tvil.

## Kostnad og planval

Dette er eit grovt anslag frå prisane til Cloudflare (sjekk [prisane](https://developers.cloudflare.com/durable-objects/platform/pricing/) før du lanserer):

- **Å lese Entur sin feed (6 MB) kostar ca. 8 ms CPU** per henting etter at parseren hoppar over andre operatørar (vi byrja på 45–73 ms).
  Det talet er målt på ei lokal maskin. På Cloudflare viste CPU-grafen for Workeren ein toppverdi på 2,64 ms og ingen feil
  (lesen 14. november 2026). Gratisplanen har ei CPU-grense på ca. 10 ms per
  førespurnad, så det er god margin. Sjekk grafen på nytt om du legg til fleire linjer.
- **Helsesjekk:** `GET /health` gir 200 når tidstabellen er lasta og yngre enn 36 timar, elles 503. Han spør ikkje Entur, så
  ein uptime-sjekk kvart minutt held ikkje Entur-henting i gang.
- **Workers Paid** (5 dollar i månaden) har 30 sekund CPU og er det trygge valet om gratisplanen gir CPU-feil.
- Ein spelar som lèt sida stå oppe i ein time gir ca. 240 førespurnader til objektet. Hundre timar i døgnet er rundt 24 000
  førespurnader, vel innanfor det som er inkludert.

## Domene

`workers.dev` fungerer rett frå start. For eige domene legg du til ei `routes`-linje i `wrangler.jsonc`
(`{ "pattern": "oslo-buss.example", "custom_domain": true }`) og eig domenet gjennom Cloudflare.
Cache API verkar ikkje på `workers.dev`, men Workeren treng det ikkje.

## Endre kva linjer som er med

Standardlista er alle 97 linjene i `DEFAULT_LINES` i `scripts/build-timetable.ts`, og det er ho den nattlege jobben bygger. Endra
du lista, køyr `npm run timetable`, og køyr tidstabell-flyten på GitHub
(Actions → Tidstabell → Run workflow) så `data`-grenen blir oppdatert.

For å prøve færre linjer utan å endre koden, fyll ut feltet **lines** når du køyrer Tidstabell for hand (til dømes `20 31 63`).
Då gjeld det berre til neste nattlege køyring. Det er òg måten å skalere tilbake på om CPU-grensa blir overskriden: køyr
Tidstabell med færre linjer og så Publiser.

Fleire linjer gir ei større tidstabell (ca. 2,8 MB med alle 97, ca. 1 MB gzippa) og meir CPU ved kvar henting. Mål sjølv med
`npx tsx scripts/measure-lines.ts`.
