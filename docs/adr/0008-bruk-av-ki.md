# 0008. Bruk av KI i utviklinga

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Mykje av koden i prosjektet er skriven saman med Claude Code (eit KI-verktøy for kode). Ved dokumentasjonstidspunktet har 52 av 77 commits på `main` ei
`Co-Authored-By: Claude`-linje i meldinga. Spørsmålet er korleis dette skal brukast og vere synleg, slik at andre kan vurdere koden på eit riktig grunnlag.

## Avgjerdsdrivarar

- Ærleg om kva som er skrive korleis. Ingen skal måtte gjette.
- Kvaliteten skal ikkje avhenge av kven eller kva som skreiv koden.
- Eigaren skal forstå og stå inne for det som er i repoet.
- Auka fart er målet, ikkje å erstatte forståing.

## Alternativ

### A. KI som medhjelpar, med synleg medforfattarlinje og vanleg kontroll (valt)

- Fordelar: Høg fart. Ærleg og etterprøvbart (`git log`). Same kontroll som for ein menneskeleg medutviklar.
- Ulemper: Risiko for kode som ser rett ut og ikkje er det, og for at eigaren ikkje har lese alt like nøye.

### B. Skrive alt for hand

- Fordelar: Full og jamn forståing.
- Ulemper: Mykje saktare. Prosjektet ville ikkje fått same omfang (0007).

### C. Bruke KI utan å seie frå

- Fordelar: Ingen.
- Ulemper: Uærleg overfor lesarar og framtidige vedlikehaldarar. Ikkje ein reell kandidat.

## Avgjerd

**Alternativ A.** Endringar går gjennom pull request. Typesjekk og testar (CI) køyrer på kvar PR, og eigaren set retninga og godkjenner kvar merge.
Medforfattarlinja står i commit- og PR-tekstane, og README seier at mykje av koden er skriven med Claude Code.

## Konsekvensar

**Positive:**
- Open om arbeidsmåten. Kontrollen er den same uavhengig av kven som skreiv.
- Testane har fanga reelle feil i KI-skriven kode. Eit døme: `Feeds.load()` stoppa å sjekke GitHub etter første kall med fersk kopi i minnet (`loading` blei ståande på eit ferdig løfte). Feilen låg i koden i ei tid og blei funnen då testar for Feeds blei skrivne, 14. november 2026.

**Negative, og kva vi gjer med dei:**
- Kode kan sjå rett ut utan å vere det. Dempa av testar, typesjekk og gjennomgang av endringar. Dei visuelle delane har færre testar og blir sjekka for hand.
- Eigaren kan vere mindre kjend med enkeltdelar. Dempa av dokumentasjon (`README.md`, `docs/`, desse ADR-ane) og av at endringar blir forklarte i PR-tekstane.

## Vurder på nytt når

- Prosjektet får fleire utviklarar, eller andre krav til sporbarheit.
- Det kjem ein feil eller sikkerheitsproblem som KI-bruken ikkje er forklaring nok for.

## Relatert

[0004](0004-direkte-deploy.md), [0007](0007-omfang.md), `README.md` («Korleis prosjektet er laga»).
