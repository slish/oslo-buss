# 0004. Direkte deploy til produksjon ved push til `main`

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Deploy-flyten (`.github/workflows/deploy.yml`) køyrer ved push til `main`: typesjekk, testar, bygg og `wrangler deploy`. Det finst éin produksjonsversjon
på `workers.dev`, ingen staging og ingen manuell godkjenning. Endringar kjem inn via pull request, og CI (`ci.yml`) køyrer på kvar PR.

## Avgjerdsdrivarar

- Éin utviklar, éin eigar av avgjerda om kva som blir med.
- Rask tilbakemelding: ei retting skal vere live utan ekstra steg.
- Tenesta har ingen kritisk funksjon og ingen persondata.
- Rollback må vere enkel.

## Alternativ

### A. Direkte deploy frå `main` (valt)

- Fordelar: Enklast. Det som er på `main` er det som køyrer.
- Ulemper: Ein feil som slepp gjennom testane er live med éin gong.

### B. Staging-miljø (eiga Worker og eige objekt) og promotering

- Fordelar: Feil blir sett før dei når produksjon.
- Ulemper: Dobbelt oppsett, eigen konfigurasjon og eige objekt. Staging har ikkje den same trafikken, så han fangar mindre enn han ser ut til.

### C. Gradvis utrulling (`wrangler versions upload` og `versions deploy` med prosent)

- Fordelar: Fangar feil på ein del av trafikken. Same plattform.
- Ulemper: Meir styring i flyten. På dette volumet er prosentdelar lite meiningsfulle.

### D. Manuell godkjenning (GitHub Environments)

- Fordelar: Eit menneskeleg steg før produksjon.
- Ulemper: Med éin utviklar er godkjenninga den same personen som merga. Mest formalitet.

### E. Førehandsvising per pull request

- Fordelar: Kan sjå endringa køyre før ho blir merga.
- Ulemper: Krev eigen Worker per PR og opprydding. Lokal dev-tenar dekkjer i dag det behovet.

## Avgjerd

**Alternativ A**, med desse sikringane: PR og CI før merge (typesjekk og alle testar), same kontroll ein gong til i deploy-flyten, og
`npx wrangler rollback` som tilbakeveg. Deploy hoppar over publiseringa, utan feil, om Cloudflare-hemmelegheitene manglar.

## Konsekvensar

**Positive:**
- Kort veg frå endring til live. Ingen ekstra miljø å halde like.
- Rollback til førre versjon er éi kommando.

**Negative, og kva vi gjer med dei:**
- Ein feil som slepp gjennom testane er live. Dei visuelle delane (3D-teikninga) har få automatiske testar, så desse blir sjekka for hand lokalt før merge.
- Tidstabell og kartfliser er data, ikkje kode, og går utanom denne flyten (0003).

## Vurder på nytt når

- Fleire utviklarar jobbar i same repo, eller tenesta får brukarar som forventar tilgjenge.
- Det kjem ein feil i produksjon som staging eller gradvis utrulling ville fanga.

## Relatert

[0003](0003-github-som-datalager.md), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/DRIFT.md`.
