# 0002. Ope API utan autentisering og utan rate limiting

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Worker-en svarar på `/feeds/buses`, `/data/timetable.json`, `/feeds/weather` og `/health` med `access-control-allow-origin: *`. Det finst ingen
nøkkel, innlogging eller grense per klient. Dataa kjem frå opne kjelder (Entur under NLOD, MET Norway, OpenStreetMap og Kartverket) og er
filtrert og bearbeidd. Tenesta har ingen personopplysningar og ingen brukarkontoar.

## Avgjerdsdrivarar

- Ingen konfidensielle data. Ingen innlogging, så ingen personvernplikter.
- Fanprosjekt: lite vedlikehald, ingen kostnad.
- Ingen skal bli stoppa av CORS når dei vil bruke tidstabellen eller bussvisinga i eigne verktøy.
- Gratisplanen svikter lukka: ved overbruk går sida ned når grensa er nådd, og det kjem ingen rekning.

## Alternativ

### A. Ope API med CORS `*` (valt)

- Fordelar: Enklast. Alle kan bruke dataa, i tråd med lisensane.
- Ulemper: Trafikk du ikkje kan skru av. Éin klient kan bruke opp dagskvoten.

### B. CORS avgrensa til eige domene

- Fordelar: Hindrar bruk frå andre nettsider.
- Ulemper: Stoppar ikkje `curl` eller skript, så vernet er svakt. Hindrar nytte for andre.

### C. Rate limiting (Cloudflare WAF eller per klient i objektet)

- Fordelar: Verner mot ein enkelt aggressiv klient.
- Ulemper: Meir oppsett og drift. Per-klient-grense i objektet gjer at den dyraste delen (objektet) tek jobben.

### D. API-nøkkel

- Fordelar: Full kontroll over kven som brukar tenesta.
- Ulemper: Nøkkelhandtering, utsteding og støtte. Ikkje i proporsjon med eit fanprosjekt.

## Avgjerd

**Alternativ A.** Opent API, utan grenser. Overforbruk blir handtert ved at planen svikter lukka, og ved bufferen frå 0001 som tek ein del av lasta.

## Konsekvensar

**Positive:**
- Ingen nøklar, ingen innlogging, ingen personopplysningar å forvalte.
- Enkelt for andre å bruke.

**Negative, og kva vi gjer med dei:**
- Misbruk kan ta dagskvoten på gratisplanen og slå ut tenesta. Oppdaga via `/health` og ein uptime-sjekk (ikkje sett opp enno).
- På betalt plan (Workers Paid) er trafikken ein variabel kostnad som ikkje kan skrivast av.

## Vurder på nytt når

- Tenesta går over på betalt plan, eller det kjem synleg bruk frå andre enn dei som brukar sida.
- Det blir lagt til noko som er personleg, eller som ikkje har open lisens.

## Relatert

[0001](0001-eitt-durable-object.md), [0006](0006-cloudflare-workers.md), `NOTICE.md`.
