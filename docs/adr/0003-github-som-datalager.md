# 0003. GitHub-grener som datalager for tidstabell og kartfliser

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Tenesta treng to slags ferdig bygde data. **Tidstabellen** (ca. 2,8 MB, ca. 1 MB gzippa) blir bygd kvar natt frå Entur sin GTFS (50 MB) av ein GitHub Action
og må vere lesbar frå Worker-en. **Kartflisene** (ca. 12,8 MB rått, 9,5 MB brotli, pluss fint terreng) blir bygde for hand frå Kartverket-data og
må med i bygget ved deploy. Verken tidstabellen eller flisene høyrer heime i `main`.

## Avgjerdsdrivarar

- Gratis og utan ekstra teneste å drifte.
- Eit publiseringssteg som allereie finst i same verktøykjede (GitHub Actions).
- Tidstabellen skal ikkje auke historikken i repoet for kvar natt.
- Tenesta skal tole at kjelda er nede.

## Alternativ

### A. Eigne grener, `data` og `tiles` (valt)

- Fordelar: Gratis, ingen ekstra konto, same autentisering som Actions. Grenene held dataa unna `main`.
- Ulemper: GitHub er ikkje eit objektlager: `raw.githubusercontent.com` har ingen SLA og har rate limits. Ei gren som blir skriven over har ikkje historikk av seg sjølv.

### B. Cloudflare R2 (objektlager) med versjonerte nøklar

- Fordelar: Laga for dette. Versjonering og rollback er innebygd. Same plattform som resten.
- Ulemper: Ny teneste, ny bindingsflate og eigne tilgangsnøklar i Actions. Mykje for to filer.

### C. Cloudflare KV

- Fordelar: Enkelt å lese frå Worker-en.
- Ulemper: Verdigrense på 25 MB per nøkkel passar for tidstabellen, men eventually consistent, og eit skrivesteg må likevel byggast.

### D. Ei gren med vanlege commits (full historikk)

- Fordelar: Full historikk, rollback via `git revert`.
- Ulemper: Ca. 1 MB gzippa per natt gir godt over 300 MB i året i repoet.

### E. GitHub Releases eller Actions-artefakt

- Fordelar: Versjonerte filer med eigen livssyklus.
- Ulemper: Artefaktar har kort levetid (maks 90 dagar) og krev autentisering for å lastast ned.

## Avgjerd

**Alternativ A**, med to forsvar mot ulempene:
1. Objektet lagrar si eiga gzippa kopi av tidstabellen og brukar henne når GitHub ikkje svarar (`src/worker/pack.ts`, 0001).
2. `data`-grenen er éin commit som blir skriven over, men held dei 7 siste tidstabellane som daterte filer. Tidstabell-flyten har eit felt **restore** som gjer ein av dei til gjeldande.

Før publisering avviser `npm run check-timetable` ei tidstabell som er tom, for kort, har tilvisingar til ukjende haldeplassar eller ikkje dekkjer dei neste 5 dagane.

## Konsekvensar

**Positive:**
- Ingen ekstra teneste, ingen ekstra nøklar, ingen kostnad.
- GitHub-avbrot rører ikkje drifta så lenge objektet har kopi. Kaldstart utan kopi og utan GitHub gir 503 (testa).
- Tidstabellen har rollback i sju dagar.

**Negative, og kva vi gjer med dei:**
- Ei gyldig men dårleg tidstabell blir publisert, og alle får henne etter høgst 30 minutt. Rullast tilbake med **restore**.
- Avhengnad av `raw.githubusercontent.com` utan SLA. Dempa av lagra kopi.
- Rollback utover sju dagar finst ikkje.

## Vurder på nytt når

- Fleire datasett skal publiserast på same måte, eller dei må leverast med garantiar.
- Tenesta får brukarar som forventar tilgjenge, og GitHub-avhengnaden ikkje lenger er akseptabel. Då bør dataa flyttast til R2 med versjonerte nøklar.

## Relatert

[0001](0001-eitt-durable-object.md), [0004](0004-direkte-deploy.md), `docs/HOSTING.md`, `docs/KARTVERKET.md`, `.github/workflows/timetable.yml`.
