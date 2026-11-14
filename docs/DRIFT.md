# Drift

Korleis tenesta køyrer, kva som skjer når noko svikter, og kva som er val med eit pris. Oppsettet står i
[HOSTING.md](HOSTING.md); her er det feilscenaria og vala. Vala er skrivne ut med alternativ og konsekvensar i [adr/](adr/README.md).

## Delane

| Del | Kva | Kvar |
|---|---|---|
| Worker | Serverer sida frå `dist/` og sender `/feeds/buses`, `/data/timetable.json` og `/health` til objektet. Bussvaret og vêret blir hugsa nokre sekund (bussar) og 30 minutt (vêr) i Worker-en sitt minne, så mange samtidige spelarar gir færre kall vidare. Vêret (`/feeds/weather`) går ikkje via objektet | Cloudflare Workers |
| `Feeds` (Durable Object) | Éin instans (`idFromName('main')`). Held tidstabellen og bussvisinga, og er det einaste stedet som spør Entur: éin førespurnad kvart 15. sekund, berre medan nokon spør | Cloudflare |
| Tidstabell | Bygd kvar natt (03:30 UTC) av GitHub Actions frå Entur sin GTFS, sjekka av `npm run check-timetable` og lagt som éin commit på grenen `data`, saman med dei 6 førre dagane som daterte filer | GitHub |
| Kartfliser | Ferdig bygde filer på grenen `tiles`, tekne med i bygget ved deploy | GitHub, så Workers-assets |
| Deploy | Push til `main` kjører typesjekk, testar, bygg og `wrangler deploy`. Tilbake: `npx wrangler rollback` gir førre versjon | GitHub Actions |

## Feilscenario

| Kva svikter | Kva skjer | Merkar brukaren det? | Kva ein gjer |
|---|---|---|---|
| **Entur er nede eller svarar feil** | Feeden held siste gode svar i 5 minutt. Deretter følgjer bussane rein rutetabell, og svaret er merkt `stale: true`. Ein ny henting blir prøvd tidlegast etter 15 s | Bussane blir plasserte etter rutetabell i staden for sanntid; forseinking manglar | Ingenting. `/health` tel ikkje Entur, så sjekken held seg grøn |
| **GitHub er nede** (`raw.githubusercontent.com`) | Objektet brukar kopien i eige lager (gzippa) og prøver igjen etter eitt minutt. Kaldstart etter utkasting går òg frå lageret | Ingen | Ingenting |
| **GitHub er nede og lageret er tomt** (første oppstart, eller lageret er tømt) | `/feeds/buses` og `/data/timetable.json` svarar 503, `/health` svarar 503 | Ja, ingen bussar | Vent, eller køyr Tidstabell og Publiser for hand |
| **Ugyldig eller tom rutetabell** | `check-timetable` avviser fila før ho blir pusha til `data`; den gamle blir liggjande | Ingen | Sjå feilmeldinga i Actions-køyringa |
| **Ei dårleg men gyldig tidstabell er publisert** | Alle får henne etter høgst 30 minutt | Ja | Køyr Tidstabell med feltet **restore** (til dømes `2026-11-12`): grenen får tilbake den datoen, og objektet hentar han ved neste sjekk |
| **Nattjobben feilar fleire netter på rad** | Objektet brukar den siste tidstabellen så lenge han har turar i dag. Etter 36 timar svarar `/health` 503 | Etter kvart: tomme dagar | Uptime-sjekken på `/health` er varselet. Køyr Tidstabell for hand |
| **CPU-grensa blir broten** (gratisplan: ca. 10 ms per førespurnad) | Cloudflare gir feil 1102 på førespurnaden | Enkelte hentingar feilar | Målt toppverdi er 2,64 ms (14. nov 2026). Går han opp: færre linjer (HOSTING.md) eller Workers Paid |

## Helsesjekk

`GET /health` gir 200 når tidstabellen er lasta og yngre enn 36 timar, elles 503, med JSON om alderen og tidspunktet for siste
Entur-oppdatering. Han spør ikkje Entur og kostar éin liten førespurnad til objektet.

**Varsling:** UptimeRobot sjekkar `https://oslo-buss.oslo-buss.workers.dev/health` og varslar når han ikkje svarar 200. Sjekken slår ut
når tidstabellen manglar eller er eldre enn 36 timar (nattjobben har feila fleire netter), eller når Worker-en ikkje svarar i det heile
(til dømes at dagskvoten er brukt opp). Entur-feil gir ikkje alarm, med vilje: bussane følgjer då rutetabellen. Same sjekk på Azure er
ein Application Insights availability test, og i Cloudflare ein Health Check.

## Kostnad

- Gratisplanen held: ein spelar som lèt sida stå i ein time gir ca. 240 førespurnader til objektet, og kartfilene er statiske
  filer som ikkje kjører kode.
- Workers Paid (5 dollar i månaden) er trygg reserve om CPU-grensa blir eit problem.
- Trafikken kan ikkje skrivast av: API-et er ope (sjå under).

## Val og kva dei kostar

- **Eitt objekt for alt.** Det er det som gjer at Entur ser éin førespurnad kvart 15. sekund. Prisen er eitt feilpunkt og eit tak
  på kor mykje éin instans orkar. Ein kort buffer i Worker-en (4 s for bussar) tek ein del av lasta, utan å love noko: kvar isolate spør for seg. Ved høg trafikk ville feeden bli delt, til dømes per region, med ei delt hurtigbuffer framføre.
- **Ope API, CORS `*`, ingen rate limiting.** Greitt for eit fanprosjekt med data som er open frå før. Ville ein hatt ekte brukarar
  eller betalt plan, hadde det trengst nøkkel eller grense per klient (Cloudflare WAF rate limiting).
- **GitHub som datalager, med force-push av `data`-grenen.** Enkelt og gratis, og objektet har ei eiga kopi som dekkjer eit
  GitHub-avbrot. Grenen blir skriven over, men dei 7 siste tidstabellane ligg som daterte filer, og Tidstabell-flyten kan
  gå tilbake til ein dato. `check-timetable` stoppar dei verste feila før publisering. I produksjon ville ein brukt
  objektlager med versjonering.
- **Deploy rett til produksjon ved push til `main`.** Typesjekk og testar køyrer først, men det er ingen staging eller godkjenning. `npx wrangler rollback` gir førre versjon.
- **«Sanntid» i infopanelet.** Berre forseinkinga kjem frå Entur sin sanntidsfeed; posisjonen blir rekna ut frå rutetabellen
  og forseinkinga. Panelet seier det.
- **Cloudflare i staden for Azure eller AWS.** Det passa for eit hobbyprosjekt: gratis, ein deploy-kommando og Durable Objects
  til det som må vere éin stad. Korleis delane svarar til Azure står under.
- **Omfang.** 3D, vêr, snø og gange i førsteperson er langt meir enn drifta trengde. Dei er med fordi prosjektet er eit
  leikeområde og ein måte å øve på.

## Kva svarar til kva på Azure

| Her | Azure |
|---|---|
| Worker + assets | Azure Static Web Apps, eller Azure Front Door framføre Functions/Container Apps |
| Durable Object (éin stad med tilstand) | Azure Functions Durable Entities, eller éin Container Apps-instans med Redis som delt buffer |
| Entur-henting kvart 15. sekund (berre ved bruk) | Funksjon med Redis-lås og TTL, eller Timer trigger om ein godtek henting heile døgnet |
| `data`-grenen på GitHub | Blob Storage med versjonering og lifecycle-reglar |
| Nattleg Action | Timer trigger-funksjon, eller Container Apps Job |
| Cloudflare observability | Application Insights og Log Analytics |
| `/health` + ekstern sjekk | Application Insights availability test |
| Rate limiting (manglar) | API Management eller Front Door WAF |

## Ikkje gjort enno

- Staging-miljø.
- Cache API framfor objektet: det fungerer ikkje på `workers.dev`, berre med eige domene (sjå HOSTING.md).
