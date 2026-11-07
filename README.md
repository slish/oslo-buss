# oslo-buss

Fanprosjekt: Oslo-busser som lyspunkt på eit kart, med sanntid frå Entur. Fase 1: datapipeline og relay. Fase 2: 3D-kart med bussar som lyspunkt. Fase 3: vegar og bygg frå OpenStreetMap. Fase 4: hosting på Cloudflare (`docs/HOSTING.md`).
**Live:** https://oslo-buss.oslo-buss.workers.dev

Linjer: **20** (Skøyen – Galgeberg), **24** (Fornebu vest – Brynseng), **31** (Snarøya – Grorud), **46** (Majorstuen – Ullerntoppen), **54** (Kværnerbyen – Kjelsås), **58** (Nydalen – Tveita), **63** (Grorud T – Romsås ring), **70** (Nationaltheatret – Skullerud), **71** (Bjørndal – Mortensrud) og **130** (Sandvika – Skøyen).

```bash
npm install
npm run timetable   # lastar ned Entur sin GTFS for Ruter, lagar public/data/timetable.json (~175 kB)
npm run map         # hentar vegar og bygg langs linjene frå OpenStreetMap (Overpass), lagar public/data/map.json (~1,1 MB)
npm run smoke       # sjekk mot Entur: skriv ut bussane som er på vegen no
npm run dev         # 3D-kartet på http://localhost:5173 (relayen køyrer inne i dev-tenaren)
npm run relay       # relayen åleine: http://localhost:5190/feeds/buses
npm test
npm run kartverket:download   # opne Kartverket-data for Oslo/Bærum til data-cache/kartverket/ (sjå docs/KARTVERKET.md)
npm run kartverket:tiles      # lagar fliser i data-cache/tiles/
npm run worker      # heile Cloudflare-oppsettet lokalt (etter npm run build): http://127.0.0.1:8787
npm run deploy      # publiserer til Cloudflare (sjå docs/HOSTING.md)
```

## Korleis det heng saman

- `scripts/build-timetable.ts` filtrerer GTFS-fila (50 MB) til dei valde linjene: vegformer (`shapes.txt`), stopp og
  rutetabell, delt i mønster som turane deler. Køyr han éin gong i døgnet (GitHub Action).
- `src/relay/buses.ts` hentar Entur sine TripUpdates (maks éin gong per 15 s for alle), filtrerer til desse turane og
  reknar ut kvar buss er. Sjølve motoren ligg i `src/shared/position.ts`.
- **Posisjonar er berekna, ikkje målte.** Ruter sender ingen GPS-posisjonar til Entur. Bussen blir plassert langs vegforma
  etter forventa tid mellom to stopp, og står stille ved stopp mellom ankomst og avgang. Ho står ikkje i kø eller lyskryss.
- `src/web/` er kartet (three.js). Relayen seier kor langt langs vegen kvar buss er og kor fort han går, så nettlesaren
  held bussane i gong mellom svara (kvart 15. sekund) og trekker dei mjukt mot sanninga når nytt svar kjem.
- `scripts/build-map.ts` hentar vegar og bygg frå OpenStreetMap i felt nær linjene (bygg innan 300 m, mindre vegar innan
  900 m) og lagar `public/data/map.json`. Svara blir mellomlagra i `data-cache/osm/`, så Overpass blir spurt éin gong. Kartfila
  er sjekka inn og blir ikkje bygd på nytt av CI.
- Relayen kallar aldri Entur frå nettlesaren, og held siste gode kopi i 5 minutt før han fell tilbake til rutetabellen.

Entur ber alle klientar sende `ET-Client-Name` (`firma-applikasjon`). Namnet står i `src/shared/client.ts`.

## Kreditering

Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Entur AS
([lisens](https://data.norge.no/nlod/en/2.0)). Dataene er filtrert og bearbeidet.
Kart © [OpenStreetMap-bidragsytarar](https://www.openstreetmap.org/copyright) (ODbL), henta via Overpass.
Kartfliser frå Kartverket (greina `kartverket-data`, `docs/KARTVERKET.md`): Kartdata © Kartverket (CC BY 4.0).
Fanprosjekt, ikkje tilknytt eller støtta av Ruter, Entur eller Kartverket. Sjå `NOTICE.md`.

## Lisens

Koden er MIT (`LICENSE`). Dataa har eigne lisensar, sjå `NOTICE.md`.
