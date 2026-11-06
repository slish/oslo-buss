# Hosting på Cloudflare

Oslo-buss køyrer som ein Cloudflare Worker utan tenar å vedlikehalde.

| Del | Kor | Kostnad |
|---|---|---|
| Sida (`dist/`) og kartfila `data/map.json` | Worker static assets | Gratis og ubegrensa, køyrer ingen kode |
| `/feeds/buses` og `/data/timetable.json` | Worker → ein Durable Object (`Feeds`) | Sjå under |
| Dagleg tidstabell | GitHub Action → grenen `data` i dette repoet | Gratis |

## Korleis det heng saman

- **Éin Durable Object for alle.** Alle førespurnader til `/feeds/*` går til same objekt (`idFromName('main')`). Det er det som
  gjer at Entur ser éin førespurnad kvart 15. sekund uansett kor mange som ser på, og berre medan nokon spør.
- **Tidstabellen** hentar objektet frå `TIMETABLE_URL` (`wrangler.jsonc`, grenen `data`), les han på nytt kvar sjette time, og
  held siste gode kopi om GitHub ikkje svarar. Nettlesaren får han frå `/data/timetable.json`, slik at han alltid er den same
  som relayen bruker.
- **Kartfila** (`public/data/map.json`) er sjekka inn og følgjer med bygget som ei vanleg fil.

## Første gong

1. Logg inn (opnar nettlesaren, du godkjenner sjølv):

   ```bash
   npx wrangler login
   ```

2. Publiser (byggjer sida og lastar opp Worker og Durable Object):

   ```bash
   npm run deploy
   ```

   Wrangler skriv ut adressa, `https://oslo-buss.<konto>.workers.dev`.

3. Sjekk at det lever: opne adressa, eller `curl https://oslo-buss.<konto>.workers.dev/feeds/buses`.

Lokal prøve av heile oppsettet utan konto: `npm run build && npm run worker`, og opne `http://127.0.0.1:8787`.

## Kostnad og planval

Dette er eit grovt anslag frå prisane til Cloudflare (sjekk [prisane](https://developers.cloudflare.com/durable-objects/platform/pricing/) før du lanserer):

- **Å lese Entur sin feed (6 MB) kostar ca. 8 ms CPU** per henting etter at parseren hoppar over andre operatørar (vi byrja på 45–73 ms).
  Det er målt på ei lokal maskin, ikkje på Cloudflare. Gratisplanen har ei CPU-grense på ca. 10 ms per førespurnad, så det
  kan gå, men er knapt. Sjekk loggane (`observability` er på) etter første dag.
- **Workers Paid** (5 dollar i månaden) har 30 sekund CPU og er det trygge valet om gratisplanen gir CPU-feil.
- Ein spelar som lèt sida stå oppe i ein time gir ca. 240 førespurnader til objektet. Hundre timar i døgnet er rundt 24 000
  førespurnader, vel innanfor det som er inkludert.

## Domene

`workers.dev` fungerer rett frå start. For eige domene legg du til ei `routes`-linje i `wrangler.jsonc`
(`{ "pattern": "oslo-buss.example", "custom_domain": true }`) og eig domenet gjennom Cloudflare.
Cache API verkar ikkje på `workers.dev`, men Workeren treng det ikkje.

## Endre kva linjer som er med

Linjene står i `DEFAULT_LINES` i `scripts/build-timetable.ts`. Endra du dei, køyr `npm run timetable` og `npm run map`, sjekk
inn `map.json`, og køyr tidstabell-flyten på GitHub (Actions → Tidstabell → Run workflow) så `data`-grenen blir oppdatert.
