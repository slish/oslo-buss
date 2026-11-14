# 0007. Omfang og prioritering

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Prosjektet starta som eit kart der Ruter-bussar er lysande punkt over Oslo, og enda opp med 3D-bussmodellar, terreng og bygg frå Kartverket og OpenStreetMap,
døgnrytme med sol og måne, vêr og snø frå MET, sitt-på-bussen og gange i førsteperson. Éin del av dette er drift: ei relay-teneste, ei nattleg tidstabell og ei
sikra publisering. Resten er produkt. Eigaren sa frå om at målet var noko «eige og kult».

## Avgjerdsdrivarar

- Eit fanprosjekt skal vere moro og lærerikt å bygge, og vise noko ein ikkje har sett før.
- Drifta må vere liten nok til at ein person kan halde henne.
- Det som er synleg for ein bruker er kartet, ikkje relayen.

## Alternativ

### A. Brei produktopplevinga, med drift tilpassa (valt)

- Fordelar: Eit prosjekt som skil seg ut og lærer bort mykje (3D, geodata, shaderar, sanntid).
- Ulemper: Stor kodeflate for eitt prosjekt. Fleire delar å halde ved like, og fleire delar utan automatiske testar.

### B. Smalt: berre punkt på eit mørkt kart, med fokus på drift og kvalitet

- Fordelar: Mindre kode og færre feilkjelder. Lettare å teste og forklare.
- Ulemper: Mykje mindre særpreg. Prosjektet ville ikkje vore like interessant å bygge eller å vise fram.

### C. Berre produktet, utan driftsdokumentasjon og tilsyn

- Fordelar: Raskast å få synleg framgang.
- Ulemper: Prosjektet blir vanskeleg å ta over eller å forklare drifta av.

## Avgjerd

**Alternativ A**, og driftsdelen blir tatt igjen med tilsyn, testar og dokumentasjon: `/health`, testar for Feeds og Worker, `docs/DRIFT.md`, ADR-ar og CI.

## Konsekvensar

**Positive:**
- Eit prosjekt med eigenart og mange delar som kan forklarast.
- Mykje av logikken er reine funksjonar og dermed testbar (118 testar ved dokumentasjonstidspunktet).

**Negative, og kva vi gjer med dei:**
- Dei visuelle delane (3D-teikninga) har få automatiske testar. Dei blir sjekka for hand i dev-visaren, og det er ei kjend avgrensing.
- Mange delar å vedlikehalde for ein person. Derfor held reine funksjonar og delte hjelparar (`geom.ts`, `overpass.ts`) kodeflata lågare.
- Omfanget går ut over meir drifts- og ytelsesarbeid enn eit driftsprosjekt ville hatt.

## Vurder på nytt når

- Prosjektet skal ha andre brukarar enn eigaren, eller det skal vere meir enn eit leikeområde.
- Delar av funksjonaliteten blir for dyre å vedlikehalde. Då er det rett å fjerne eller isolere dei, ikkje halde alt oppe.

## Relatert

[0001](0001-eitt-durable-object.md), [0008](0008-bruk-av-ki.md), `README.md`.
