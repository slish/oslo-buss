# Notice

## Kode frå under-stockholm (MIT)

`src/shared/protobuf.ts` er tilpassa den handskrivne protobuf-lesaren i
[joelhagvall/under-stockholm](https://github.com/joelhagvall/under-stockholm)
(`server/gtfs.ts`), MIT-lisens, Copyright (c) 2026 Joel Hägvall.

## Data

Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Entur AS.
Lisens: https://data.norge.no/nlod/en/2.0
Dataene er filtrert og bearbeidet: busposisjonar er berekna frå rutetabell og sanntidsforseinkingar.

Fanprosjekt. Ikkje tilknytt eller støtta av Ruter eller Entur.

Vêrdata frå MET Norway (https://api.met.no/), lisens CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) og NLOD 2.0. Vêret er redusert til nokre tal (skydekke, nedbør, temperatur, vind).

Kart: © OpenStreetMap-bidragsytarar (ODbL), https://www.openstreetmap.org/copyright. `public/data/map.json` er eit utval av desse dataa og følgjer ODbL.

Kartdata © Kartverket, lisens CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Frå Geonorge: N50 Kartdata, NVDB Vegnett Pluss, Matrikkelen – Bygningspunkt og Nasjonal høgdemodell (DTM/DOM). Dataa er bearbeidde (forenkla, klipte til fliser, byggehøgd rekna ut frå overflate- minus terrengmodell). Sjå `docs/KARTVERKET.md`. I `?kart=kartverket`-fliser kjem bygg òg frå OpenStreetMap (© OpenStreetMap-bidragsytarar, ODbL). Kartverket-logoen er ikkje brukt, og Kartverket støttar ikkje prosjektet.
