# 0006. Cloudflare Workers som plattform

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Tenesta treng statiske filer, to liveendepunkt og éin stad med tilstand (0001), og ho skal koste så godt som ingenting når ingen brukar ho.
Valet av plattform påverkar kva som kan delast mellom tenesta og dev-tenaren, kva ho kostar, og kor lett det er å flytte.

## Avgjerdsdrivarar

- Gratis eller nesten gratis ved låg trafikk, utan fast infrastruktur.
- Ein stad med tilstand utan å drifte server (0001).
- Éi deploy-kommando, liten konfigurasjon.
- Lite innlåsing: kjernelogikken skal kunne køyre andre stader.

## Alternativ

### A. Cloudflare Workers med Durable Objects og Assets (valt)

- Fordelar: Gratis nivå som held. Durable Object løyser «éin stad». Statiske filer er gratis og køyrer ingen kode. `wrangler deploy` er eit steg. Innebygd observability.
- Ulemper: Plattformspesifikt API (Durable Objects). CPU-grense på gratisplanen (ca. 10 ms per førespurnad). Cache API verkar ikkje på `workers.dev`.

### B. Azure (Static Web Apps, Functions, Durable Entities eller Container Apps, Blob Storage)

- Fordelar: Same økosystem som mange verksemder. Gode verktøy for drift (Application Insights).
- Ulemper: Fleire delar å sette opp og binde saman. Ingen like enkel «éin stad med tilstand»-modell. Meir konfigurasjon og høgare minstekostnad for same funksjon.

### C. AWS (Lambda, DynamoDB, S3, CloudFront)

- Fordelar: Moden plattform.
- Ulemper: Same som B. Éin stad med tilstand krev ekstra teneste.

### D. Fly.io, Railway eller ein eigen VM

- Fordelar: Ein ordinær prosess, kjent modell.
- Ulemper: Fast kostnad og drift heile døgnet.

## Avgjerd

**Alternativ A.** Delane svarar til Azure-tenester slik at ei flytting er mogleg å forklare (`docs/DRIFT.md`). Kjernelogikken, `src/relay/buses.ts` og `src/shared/`, har ikkje
Cloudflare-avhengnader og køyrer òg i Node: dev-tenaren (`vite.config.ts`) brukar den same relayen lokalt.

## Konsekvensar

**Positive:**
- Låg eller ingen kostnad, enkelt å drifte.
- Lokal utvikling brukar same kode som produksjon.
- Målt CPU-topp på Cloudflare er 2,64 ms mot grensa på ca. 10 ms (14. nov 2026).

**Negative, og kva vi gjer med dei:**
- Innlåsing i Durable Objects og `wrangler`. Avgrensa til `src/worker/`. Resten er flyttbart, men ei flytting er arbeid, ikkje konfigurasjon.
- Cache API verkar ikkje på `workers.dev`. Dempa av ein buffer i minnet (`src/worker/memo.ts`, 0001) til prosjektet får eige domene.
- Gratisplanen toler lite CPU-vekst. Nedskalering: færre linjer, eller Workers Paid (5 dollar i månaden).

## Vurder på nytt når

- Tenesta skal drivast i eit miljø som krev Azure eller AWS. Då er den naturlege flyttinga: Worker og assets til Static Web Apps, objektet til Durable Entities eller ein Container Apps-instans med Redis, og `data`-grenen til Blob Storage med versjonering.
- CPU-grensa eller Durable Object-kvotane blir for stramme.

## Relatert

[0001](0001-eitt-durable-object.md), [0003](0003-github-som-datalager.md), `docs/HOSTING.md`, `docs/DRIFT.md`.
