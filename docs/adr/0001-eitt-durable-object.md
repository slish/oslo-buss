# 0001. Eitt Durable Object som einaste Entur-klient

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Alle spelarar viser same bussar. Entur ber klientar om å ikkje spørje oftare enn naudsynt og å seie kven dei er (`ET-Client-Name`).
Utan deling ville talet på Entur-førespurnader følgt talet på spelarar. Feeden er ca. 6 MB, og å lese han kostar CPU (ca. 8 ms) som
gratisplanen til Cloudflare (ca. 10 ms per førespurnad) knapt toler å gjere ofte.

## Avgjerdsdrivarar

- Entur skal sjå éin førespurnad kvart 15. sekund, uansett kor mange som ser på, og berre medan nokon spør.
- Ingen fast prosess som kostar pengar når ingen brukar tenesta.
- Same tidstabell for relayen og nettlesaren.
- Éin utviklar, lite drift.

## Alternativ

### A. Éin Worker utan tilstand, som spør Entur ved kvar førespurnad

- Fordelar: Enklast. Ingenting å halde i live.
- Ulemper: Entur-lasta følgjer trafikken. 6 MB parsing per førespurnad. Ikkje akseptabelt overfor Entur.

### B. Worker med Cache API eller KV framfor Entur

- Fordelar: Ingen eigen tilstand. Skalerer breitt.
- Ulemper: Éin Entur-henting per datasenter, ikkje éin totalt. Cache API verkar ikkje på `workers.dev`. KV er eventually consistent og har skrivegrenser som passar dårleg til ei oppdatering kvart 15. sekund.

### C. Eitt Durable Object per region

- Fordelar: Lågare latens og meir kapasitet.
- Ulemper: Fleire Entur-klientar og meir logikk. Ikkje behov på dagens volum.

### D. Ein eigen server (VM eller container)

- Fordelar: Kjent modell, full kontroll.
- Ulemper: Drift og kostnad heile døgnet, også utan brukarar.

## Avgjerd

**Alternativ A i hovudsak, men via éitt Durable Object** (`idFromName('main')`). Objektet held tidstabellen og bussvisinga, spør Entur maks kvart 15. sekund
og deler eitt svar i to sekund. Worker-en held i tillegg eit kort minne (4 s) av bussvaret per isolate.

## Konsekvensar

**Positive:**
- Entur ser éin førespurnad per 15. sekund, og berre medan nokon spør.
- Éin stad for tilstand: ingen konsistensproblem mellom instansar.
- Eigen lagra kopi av tidstabellen gir kaldstart utan GitHub (sjå 0003).

**Negative, og kva vi gjer med dei:**
- Eitt feilpunkt og eit tak på kva éin instans orkar. Dempa av svardeling (2 s) og minnebuffer i Worker-en. Målt CPU-topp på Cloudflare er 2,64 ms (14. nov 2026).
- Objektet bur éin stad, så fjerne brukarar får litt latens. Uvesentleg for eit lokalt kart over Oslo.
- Alle førespurnader til `/feeds/buses` går til objektet (Cache API verkar ikkje på `workers.dev`).

## Vurder på nytt når

- Førespurnadene til objektet blir eit problem (CPU, grensa for førespurnader) eller brukarane er mange utanfor Noreg.
- Prosjektet får eige domene: då kan Cache API stå framfor objektet.

## Relatert

[0002](0002-ope-api.md), [0003](0003-github-som-datalager.md), [0006](0006-cloudflare-workers.md), `docs/DRIFT.md`.
