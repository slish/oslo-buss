# oslo-buss

Fanprosjekt: Oslo-busser som lyspunkt på eit kart, med sanntid frå Entur. Fase 1: datapipeline og relay.
Linjer til å byrje med: **20** (Skøyen – Galgeberg), **31** (Snarøya – Grorud) og **63** (Grorud T – Romsås ring).

```bash
npm install
npm run timetable   # lastar ned Entur sin GTFS for Ruter, lagar public/data/timetable.json (~175 kB)
npm run smoke       # sjekk mot Entur: skriv ut bussane som er på vegen no
npm run relay       # http://localhost:5190/feeds/buses
npm test
```

## Korleis det heng saman

- `scripts/build-timetable.ts` filtrerer GTFS-fila (50 MB) til dei valde linjene: vegformer (`shapes.txt`), stopp og
  rutetabell, delt i mønster som turane deler. Køyr han éin gong i døgnet (GitHub Action).
- `src/relay/buses.ts` hentar Entur sine TripUpdates (maks éin gong per 15 s for alle), filtrerer til desse turane og
  reknar ut kvar buss er. Sjølve motoren ligg i `src/shared/position.ts`.
- **Posisjonar er berekna, ikkje målte.** Ruter sender ingen GPS-posisjonar til Entur. Bussen blir plassert langs vegforma
  etter forventa tid mellom to stopp, og står stille ved stopp mellom ankomst og avgang. Ho står ikkje i kø eller lyskryss.
- Relayen kallar aldri Entur frå nettlesaren, og held siste gode kopi i 5 minutt før han fell tilbake til rutetabellen.

Sett `CLIENT_NAME` i `src/relay/buses.ts` til noko som identifiserer deg før du går live (Entur ber om `firma-applikasjon`).

## Kreditering

Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Entur AS
([lisens](https://data.norge.no/nlod/en/2.0)). Dataene er filtrert og bearbeidet. Kart © OpenStreetMap-bidragsytarar.
Fanprosjekt, ikkje tilknytt eller støtta av Ruter eller Entur. Sjå `NOTICE.md`.
