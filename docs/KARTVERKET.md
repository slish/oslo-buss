# Kartverket-data for Oslo og Bærum

Kartlegging, nedlasting og konvertering av opne data frå Kartverket/Geonorge til kartfliser for nettlesaren. Skrive 6. november 2026 på greina `kartverket-data`. Ingenting her er publisert, og `public/data/map.json` og standardutsjånaden er urørde.

## Kort fortalt

- **FKB-Bygning og FKB-Veg er ikkje opne.** Begge er «Norge digitalt begrenset» og krev innlogging og avtale (sjekka: `can-download` svarer `false` utan innlogging). Dei er hoppa over, som oppdraget seier. Det same gjeld resten av FKB-familien (Grønnstruktur, Arealbruk, TraktorvegSti m.fl.).
- **Opne erstatningar som er brukte:** N50 Kartdata (areal, bygg som omriss, bane, stiar), NVDB Vegnett Pluss (vegnettet, etterfølgjaren til Elveg 2.0), Matrikkelen – Bygningspunkt (bygg som punkt), og Nasjonal høgdemodell (DTM og DOM) via WCS.
- **Ingen opne data har byggehøgd.** Høgda er difor *rekna ut* som overflatemodell (DOM) minus terrengmodell (DTM) for 99 % av omrissa og 90 % av punkta, og gjetta frå byggtype elles. Kvart bygg har eit flagg (`heightSource`) som seier kva det er.
- Resultat: 218 fliser à 2 km, 7,0 MB rått, 5,4 MB gzip, 5,0 MB brotli. Nedlasting totalt 985 MB (av 5 GB).

## Datasett

Alle er opne utan innlogging (verifisert mot `nedlasting.geonorge.no/api`, bestilling med tom e-post). Koordinatsystem er EUREF89 UTM 32 (EPSG:25832) om ikkje anna er sagt.

| Datasett | UUID (Geonorge) | Format / CRS | Lisens | Brukt til |
|---|---|---|---|---|
| N50 Kartdata | `ea192681-d039-42ec-b1bc-f3ce04c189ac` | GML, FGDB, SOSI, PostGIS; 25832/25833/25835 | CC BY 4.0 | areal (hav, innsjø, skog, park, tettbygd …), bygg som flater, bane, stiar og traktorvegar |
| NVDB Vegnett Pluss | `97e6a869-8dd4-4379-bf39-f7d7dbf94863` | GML, SOSI; 5973 (UTM 33 + NN2000, 3D) | CC BY 4.0 | vegnett (`Veglenke`) |
| Matrikkelen – Bygningspunkt | `24d7e9d1-87f6-45a0-b38e-3447f8d7f9a1` | GML, FGDB, SOSI, PostGIS | CC BY 4.0 | bygg utan omriss: type og status |
| Nasjonal høgdemodell DTM (WCS, 25832) | `05821c51-2f5b-411f-9098-924d13dbea9a` | GeoTIFF float32, 10 m rute frå 1 m-modellen | opne data, ingen vilkår oppgitt i metadata | terreng |
| Nasjonal høgdemodell DOM (WCS, 25832) | `a456f3c2-96f6-42f0-9960-e9888fc0c2de` | GeoTIFF float32, hentar 4 m | opne data | berre til å rekne ut byggehøgd |

Andre datasett eg fann og *ikkje* brukte:

| Datasett | Status |
|---|---|
| FKB-Bygning `8b4304ea-…`, FKB-Veg `4920b452-…` | Norge digitalt begrenset, krev innlogging. Hoppa over. |
| NVDB Vegnett `ad17eb84-…` | Opent, men berre SOSI (ingen GML). Pluss har same geometri i GML, så Pluss er brukt. |
| DTM 10 historisk (UTM 32) `fd851873-…` | **CC BY-NC 4.0** (ikkje-kommersiell). Unngått; UTM 33-utgåva er CC BY 4.0. Den *gjeldande* DTM 10 skal ligge på hoydedata.no. |
| DTM1 Atom-feed `fd96e6c3-…` | Opent (CC BY 4.0), 15 km-ruter av 1 m-modellen. Ikkje henta, for stort; WCS gir 10 m-ruta direkte. |
| «Elveg 2.0» som eige datasett | Finst ikkje lenger i katalogen. NVDB Vegnett «erstatter Forenklet Elveg 2.0». |

Merk om `N50 bygg`: Berre ca. 5 400 av bygga i Oslo og Bærum er flater i N50 (resten er punkt eller utelatne). Registeret har 135 633 bygg berre i Oslo.

### Kreditering

Kartverket krev «© Kartverket» der produkta blir brukte, med lenke til Kartverket om mogleg ([vilkår for bruk](https://www.kartverket.no/api-og-data/vilkar-for-bruk)). Lisensen er CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Teksten som ligg i `index.json` og i `NOTICE.md`/`README.md`:

> Kartdata © Kartverket (CC BY 4.0)

Kartverket-logoen er ikkje brukt. NVDB-data har Statens vegvesen og kommunane som kjelder bak Kartverket sin distribusjon; lisensen i katalogen er likevel CC BY 4.0 med Kartverket som utgjevar.

### API-ar

- **Nedlasting-API** (`https://nedlasting.geonorge.no/api`): `capabilities/{uuid}`, `codelists/{projection|format|area}/{uuid}`, `POST /order` med `email: ""` gir direkte nedlastingslenkjer utan innlogging for opne datasett. Kommunar er `type: "kommune"` med kommunenummer (Oslo `0301`, Bærum `3201`). Ein `accessConstraintRequiredRole` i `capabilities` tyder at datasettet krev innlogging.
- **WCS** (`wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832`, `…dom-nhm-25832`): `GetCoverage` versjon 1.0.0, maks 3840×2160 piksel per kall, GeoTIFF. Dekningsnamn `nhm_dtm_topo_25832` og `nhm_dom_topo_25832`.
- Katalog-API: `kartkatalog.geonorge.no/api/search` og `/api/getdata/{uuid}` (metadata, lisens).

## Nedlastingslogg

Skript: `scripts/kartverket/download.ts` (trygt å køyre om att: fullførte filer blir hoppa over, delvise blir tatt opp att; ein nedlasting om gongen, 2 s pause, 5 GB-sperre). Mappe: `data-cache/kartverket/` (gitignorert; lokal logg i `download-log.jsonl`). Alt vart henta 6. november 2026 mellom kl. 20.19 og 20.25 (lokal tid).

| Fil | Storleik | Tid (UTC) | Kjelde |
|---|---|---|---|
| `Basisdata_0301_Oslo_25832_N50Kartdata_GML.zip` | 7,5 MB | 2026-11-06 19:19 | Nedlasting-API, N50 Kartdata, Oslo |
| `Basisdata_3201_Berum_25832_N50Kartdata_GML.zip` | 2,8 MB | 2026-11-06 19:19 | same, Bærum |
| `Samferdsel_0301_Oslo_5973_NVDB-VegnettPluss_GML.zip` | 35,8 MB | 2026-11-06 19:19 | Nedlasting-API, NVDB Vegnett Pluss, Oslo |
| `Samferdsel_3201_Berum_5973_NVDB-VegnettPluss_GML.zip` | 8,8 MB | 2026-11-06 19:19 | same, Bærum |
| `Basisdata_0301_Oslo_25832_MatrikkelenBygning_GML.zip` | 25,4 MB | 2026-11-06 19:19 | Nedlasting-API, Matrikkelen – Bygningspunkt, Oslo |
| `Basisdata_3201_Berum_25832_MatrikkelenBygning_GML.zip` | 7,5 MB | 2026-11-06 19:19 | same, Bærum |
| `dtm10/dtm10_<E>_<N>.tif` × 30 (10×10 km, 1000×1000 px) | 123,1 MB | 19:19–19:20 | WCS DTM, bbox 566000–616000 × 6612000–6672000 |
| `dom4/dom4_<E>_<N>.tif` × 30 (10×10 km, 2500×2500 px) | 774,2 MB | 19:21–19:24 | WCS DOM, same bbox |
| **Totalt** | **985,0 MB** | | |

Utpakka er GML-filene ca. 1,1 GB (i `data-cache/kartverket/x/`); det tel ikkje som nedlasting. Kvar bestilling er ei einskild nedlastingslenkje frå `nedlasting.geonorge.no`; dei nøyaktige URL-ane ligg i `download-log.jsonl`.

## Fliseformat

Definert i `src/shared/tiles.ts` (koding/dekoding, testar i `tests/tiles.test.ts`). Éi fil per 2 km-flis, `data-cache/tiles/{ix}_{iz}.bin`, og `index.json` med flisliste, storleikar, klassenamn og krediteringsteksten.

- Koordinatar er scene-meter (`toX`/`toZ` i `src/web/world.ts`, origo i Oslo sentrum) som heile desimeter relativt til flishjørnet, som sikk-sakk-varint av differansar.
- Seksjonar (kan hoppast over enkeltvis): bygg (omriss + høgd i dm + `heightSource` + byggtype), bygningspunkt, vegar (klasse + linje), areal (klasse + ringar, even-odd), terreng.
- Vegklassar: motorway, primary, secondary, tertiary, residential, path, rail. Arealklassar (teiknerekkjefølgje): sea, water, farmland, marsh, forest, built, park.
- Terreng: 101×101 høgdeverdiar per flis, 20 m mellom, heile desimeter, delta-koda mot nabo (`left + up − upleft`); kantane er delte med nabofliser. 10 m-modellen er nedsampla bilineært til 20 m for å halde flisene små; ei flis kan ha 10 m (201×201) om det trengst.
- Geometri er forenkla (Douglas–Peucker, `simplifyXY`): bygg 0,3 m, vegar 0,8 m, areal 2 m. Linjer og areal er klipte til flisgrensene; bygg ligg i flisa der tyngdepunktet er.

## Konvertering

`npx tsx scripts/kartverket/build-tiles.ts` (les `data-cache/kartverket/`, skriv `data-cache/tiles/`). Prosjeksjon med `proj4` (UTM 32/33 → lengd/breidd), deretter same `toX`/`toZ` som kartet. GML blir lesen straumande (`scripts/kartverket/gml.ts`) fordi NVDB-fila for Oslo er 553 MB. Heile køyringa tek ca. 40 s.

### Byggehøgd

Open Kartverket-data har ingen byggehøgd. For kvart N50-omriss er DOM − DTM samplet kvar 2. meter inne i omrisset, og 80-persentilen er brukt (taket, ikkje trea ved sida av); det blir godteke mellom 2,5 og 150 m. Bygningspunkt får største verdi av punktet og fire punkt 3 m frå. Elles gjettar `guessHeight` frå byggtypekoden (7 m enebolig, 12 m blokk, 3,5 m garasje …) og `heightSource` er 0.

## Resultat

| | Verdi |
|---|---|
| Fliser (ikkje tomme, 2 km) | 218 + `index.json` |
| Samla storleik | 6 962 833 B rått · 5 387 464 B gzip (-9) · 4 974 416 B brotli |
| Flis, median / maks (rått) | 17 674 B / 117 197 B |
| Per lag (rått → gzip) | terreng 2,25 → 1,55 MB · vegar 2,57 → 2,04 MB · bygningspunkt 1,32 → 1,01 MB · areal 0,67 → 0,58 MB · bygg 0,16 → 0,14 MB |
| Bygg som flater / punkt | 5 367 / 173 822 (av 190 773 punkt i registeret; resten har status som ikkje er i bruk eller ligg i N50-omriss) |
| Vegar | 178 004 linjer (inkl. klipping) frå NVDB, 345 bane, 3 990 stiar og traktorvegar frå N50 |
| Areal | 3 777 |
| Byggehøgd frå modell | 5 309 av 5 367 omriss (99 %), 156 408 av 173 822 punkt (90 %); median for omriss 12,3 m, 90-persentil 21,7 m |

### Med OpenStreetMap-bygg (oppdatert)

Brukartest av visaren: bygga såg betre ut i standardkartet (OSM) enn i Kartverket-fliser. Grunnen er at det opne N50-datasettet berre har generaliserte omriss av 5 367 større bygg; resten av bygga (173 822) finst berre som register*punkt* og vart teikna som 8×8 m-boksar. FKB-Bygning, som hadde skikkelege omriss, er ikkje open.

Difor er OSM-omriss no hovudkjelde for bygg der dei finst (`scripts/kartverket/osm.ts` hentar, `mergeOsm` i `build-tiles.ts` flettar). N50-omriss og punkt blir berre behaldne der OSM manglar: eit N50-omriss blir droppa viss tyngdepunktet ligg i eit OSM-omriss eller eit OSM-tyngdepunkt ligg i det, og eit punkt blir droppa viss det ligg inne i eller innan 4 m frå eit OSM-omriss. Høgd: `height`/`building:levels` frå OSM (`heightSource` 2), elles DOM−DTM (1), elles gjetting etter taggen (0). OSM-omriss ligg i eigen flisseksjon (id 6, same oppbygging som bygg frå N50) slik at ODbL og CC BY held seg skilde. Ho blir lesen inn som `osm: true`.

Resultat med alle 213 OSM-celler for Oslo og Bærum (221 994 bygningsomriss henta; 182 740 av dei ligg innanfor flisområdet etter filtrering på areal ≥ 15 m²):

| | Før | Med OSM (full dekning) |
|---|---|---|
| Samla storleik rått / gzip / brotli | 6,96 / 5,39 / 4,97 MB | 10,22 / 8,22 / 7,57 MB |
| Flis median / maks (rått) | 17,7 / 117 kB | 19,2 / 200 kB |
| Bygg som flater | 5 367 | 182 740 OSM + 341 N50 |
| Bygningspunkt (boksar) | 173 822 | 15 381 (158 441 droppa) |
| OSM-høgd frå tagg / modell / gjetta | – | 29 210 / 134 732 / 18 798 |

**Dekning:** alle cellene er henta (`data-cache/osm-buildings/`, 187 nye pluss 26 frå `data-cache/osm/`). Overpass var sakte (502/504), men skriptet prøvde på nytt av seg sjølv, og det tok nokre timar. Dei attverande 15 381 boksane er register-bygg utan OSM-omriss.

Kva som framleis er dårlegare enn standardkartet: OSM multipolygon-bygg (relasjonar, t.d. bygg med gardsrom) er ikkje med, berre enkle ways; bygg utan omriss i OSM er framleis punkt-boksar; OSM-høgdene er like usikre som før der taggen manglar (DOM−DTM).

### Statiske filer eller R2

Tala er langt under Cloudflare-grensene for statiske filer: 219 filer (grense 20 000) og største fil 117 kB, 200 kB med OSM-bygg (grense 25 MiB). Totalt 10 MB rått; Cloudflare komprimerer statiske filer (gzip/brotli) når nettlesaren ber om det, så overføring er ca. 8 MB gzip (7,6 MB brotli) for *alt*, og nettlesaren hentar berre flisene rundt kameraet.

**Tilråding: statiske filer** i same publisering. Ingen ekstra tenestar, ingen CORS eller tilgangsstyring, og same pipeline som resten. Filene er innhaldsadresserte hos Cloudflare, så berre endra fliser blir lasta opp på nytt ved ny publisering. R2 blir først aktuelt om flisene veks mykje (t.d. 1 m-terreng eller 3D-bygg med takform) og talet på filer nærmar seg 20 000 eller enkeltfiler 25 MiB; dagens fliser kan vekse fleire titals gonger før det skjer. Ulempe med statisk: kvar kartoppdatering krev ny publisering.

## Utvida dekning (7. november 2026)

Fliser dekkjer no alle 97 linjeformer i tidstabellen med 1,5 km margin (`scripts/kartverket/coverage.ts` reknar ut kva fliser det gjeld, frå `public/data/timetable.json`): 262 fliser (44 nye), 12,8 MB rått / 9,5 MB brotli, fint terreng 263 filer. Lasta ned ekstra ca. 112 MB: N50, NVDB Vegnett Pluss og Matrikkelen-bygningspunkt for Lillestrøm, Lørenskog, Rælingen, Nordre Follo, Ås og Nesodden (same CC BY 4.0), pluss to nye 10 km-blokker DTM/DOM (E 616000, N 6642000 og 6652000). `build-tiles.ts` tek berre med data frå nabokommunane i fliser som tidstabellen treng eller som fanst frå før. Etter ny tidstabell: `npm run kartverket:download`, pakk ut zip, køyr `osm.ts`, `kartverket:tiles`, `kartverket:fine`, `kartverket:publish`.

## Kvalitet og kjende problem

- **Byggehøgder er estimat.** Overflatemodellen kan vere eldre enn bygget (nybygg får feil eller gjetta høgd), og tre tett inntil og kraftige takformer påverkar tala. Ikkje verifisert mot fasit. Bygningspunkt har ikkje omriss: viss kartet skal teikne dei, må storleiken gjettast (t.d. 8×8 m).
- **Dekning av bygg:** N50-omrisset er generalisert (små bygg manglar eller er punkt). Det er den opne erstatninga; FKB-Bygning (skikkeleg omriss + høgd) krev Norge digitalt-avtale. OSM-bygga i `map.json` er i praksis meir detaljerte langs linjene.
- **Vegnett (NVDB Vegnett Pluss vs. Elveg og FKB-Veg):** Elveg 2.0 var senterlinjer for kjøreveg; NVDB Vegnett er etterfølgjaren og Pluss legg til gang-/sykkelveg, fortau m.m. Begge er *senterlinjer* (ikkje kantar). FKB-Veg er detaljerte vegkantar og -flater frå Geovekst, men ikkje open. Eg har filtrert vekk fortau, gangfelt, konnekteringslenkjer og kjørefeltsnivå (`KF`) for å unngå dobbel geometri, og klassifisert etter vegkategori (E/R/F/K/P/S). `KB` (kjørebane) og `VTKB` er begge med, så delte vegar kan ha litt dobbel geometri. «Motorway» er alle E-vegar, ikkje berre motorveg.
- **Stiar:** NVDB Pluss manglar enno mange stiar og traktorvegar; dei er henta frå N50 og kan overlappe NVDB-gangvegar.
- **Areal klipt til kommunegrensa:** N50 for ein kommune sluttar ved kommunegrensa. Utanfor Oslo/Bærum (Asker, Lillestrøm, Nordre Follo …) og for sjø utanfor kommunane er det tomt, medan terrenget går heile vegen ut til datarektangelet (E 566–616 km, N 6612–6672 km). Flisene i kanten kan ha terreng utan areal.
- **Terreng på sjø:** DTM gir 0 over sjø; heile Oslofjorden blir difor flat 0 m. Fjorddjupn er ikkje med.
- **Klipping av areal:** Sutherland–Hodgman gir null-breidde brubitar langs flisgrensa for konkave flater. Dei blir ikkje synlege med even-odd-fylling, men trianguleringa i ein visar må tole degenererte kantar.
- **Bærum og sonekanten:** NVDB kjem i UTM 33 og resten i UTM 32; alt går via lengd/breidd, så skjøtane skal vere reine, men eg har ikkje samanlikna nabofliser visuelt.
- **Verifisert visuelt (dev-visar, sjå «Visaren»):** Oslo sentrum (Bjørvika, Grønland), Fornebu/Snarøya, Romsås og Grorud er sett teikna i flat og i terrengmodus. Ingen synlege sømmar mellom fliser i vegar, bygg og areal, og NVDB (UTM 33) passar med N50 (UTM 32): vegane ligg mellom bygga der dei skal. Terrenget (Ekebergåsen, Grefsen, Romsås) ser rett ut.
- **Sømmar i terrenget:** Terrengflater har ein svak skuggeforskjell langs flisgrensa fordi skuggen reknast per flis (éi-sidig differanse i kanten). Arealfargen langs kanten måtte hentast ein hårsmonn innanfor flisa, elles vart ein tynn mørk stripe synleg.
- **Uklassifisert land:** N50 har ikkje klasse for flyplass, bart fjell m.m. (t.d. Fornebu-området), så der blir det ein dempa grunnfarge i staden for fjord-, skog- eller byfarge. Dette kan utvidast ved å ta fleire N50-klassar med i `N50_AREAS`.
- **Kommunekanten:** Utanfor Oslo/Bærum blir det mørke trekantar der sjø/areal manglar (sjå «Areal klipt til kommunegrensa»); synleg i oversiktsbildet.
- **Bygningspunkt som 8×8 m-boksar** gir tette «byklossar» i villastrøk. Det ser rimeleg ut frå avstand, men storleiken er rein gjetting.
- Bygningstype-koden frå N50 og frå registeret kan følgje ulike kodelister; `guessHeight` bruker NS 3457-tala først og fremst for registeret.
- Alder på DTM/DOM og kva år områda er målte er ikkje undersøkt.

## Slik køyrer du det på nytt

```bash
npx tsx scripts/kartverket/download.ts     # lastar ned til data-cache/kartverket/ (kan avbrytast og køyrast om att)
# pakk ut zip-filene til data-cache/kartverket/x/<zip-namn utan .zip>/ (skjer ikkje automatisk)
npx tsx scripts/kartverket/osm.ts          # (valfritt) OSM-bygg frå Overpass til data-cache/osm-buildings/, sakte og i små celler
npx tsx scripts/kartverket/build-tiles.ts  # lagar data-cache/tiles/ (--no-osm hoppar over OSM-bygga)
npm test
```

## Visaren (`?kart=kartverket`)

Valfri teikning av flisene i `src/web/kartverket.ts`. Standardutsjånaden og `public/data/map.json` er uendra.

```bash
npm run kartverket:tiles   # lagar data-cache/tiles/ (éin gong)
npm run dev                # opne http://localhost:5173/?kart=kartverket   (legg til &terreng=1 for terrengmodus)
```

- Vite-mellomvaren `devTiles` i `vite.config.ts` serverer `data-cache/tiles/` som `/kartverket-tiles/` berre i dev (`apply: 'serve'`). Flisene er ikkje i git og ikkje i produksjonsbygget; utan flaggen blir ingenting henta.
- Fliser blir henta og frigjevne etter kameraet: radius = 2,2 × avstanden til målpunktet (5–16 km), maks 90 fliser og 4 samtidige hentingar, nærmaste først. Éin flis blir bygd per bilete.
- Detaljnivå: store vegar og areal for alle lasta fliser; bygg, bygningspunkt, vegar i bustadgater og stiar berre for fliser innanfor 6,5 km frå kameraet.
- Areal blir trianguleres (`ShapeUtils`, med hol) som flate meshar utan djupnetest, i klasserekkjefølgje, over ein dempa grunnfarge. Vegar er `LineSegments` per klasse. Bygg er ekstrudert omriss med høgd (delt `extrudeBlocks` i `basemap.ts`); bygningspunkt er 8×8 m-boksar.
- `&terreng=1`: terrenget er eit skugga mesh med arealfarge i vertekssfargane; vegar, bygg, bussar, haldeplassar og linjene til bussane følgjer høgda (`heightAt`). Flat modus er standard.
- Målt i Browser-ruta i Claude (maskin utan eigen GPU-måling): 60 fps både i oversynsbiletet (90 fliser) og i nærbilete i Oslo sentrum med terreng. Bygging per flis: terreng ≈ 30 ms, bygg ≈ 11 ms, areal ≈ 2 ms.

### Kamera og 3D-bussar (gjeld òg standardkartet)

- Kameraet kan zoome ned til 20 m (`minDistance`), nesten ned til horisonten (`maxPolarAngle` 0,495π) og zoome mot peikaren (`zoomToCursor`). `near`/`far` følgjer avstanden (near 0,5–100 m, far 20–400 km) så ingenting klipper nær bakken.
- I terrengmodus held kameraet og målpunktet seg over terrenget (`keepAbove` i `main.ts`).
- Nærare enn 1,5 km frå kameraet toner det lysande punktet ut medan ein enkel lågpoly-buss (12×3×2,5 m i linjefargen, `src/web/busmodel.ts`, éin `InstancedMesh`) toner inn; heilt modell innanfor 700 m. Bussen er vend etter retninga og følgjer terrenget (også stigning) i terrengmodus. Vald buss er lysare og beheld ein liten glød. Klikk og infopanel fungerer som før. Haldeplassmarkørane (70 m store skiver) krympar når ein zoomar inn.
- Fliser for bygg/vegar blir frustum-kulla per flis; utan det fall fps til ca. 25 med dei fulle OSM-flisene i nærvising, no 56–60 i Browser-ruta.
- Kjent: ein buss kan ligge inne i eit bygg i OSM/N50-data (t.d. bussterminal under bygg), og då ser ein berre gløden.

## Neste steg

1. Ta med fleire N50-areal (flyplass, bart fjell, steinbrot) så «uklassifisert land» forsvinn.
2. Teikn terrenget mjukare (fleire sampel eller normalar) og vurder om terrengmodus skal bli standard etter at han er prøvd på mobil.
3. Bygningspunkt: avgjer storleik, og om OSM skal supplere der N50 manglar.
4. Pakk ut zip i `download.ts` så heile kjeda er eitt steg, og legg til tilhøyrande Action om fliser skal byggast automatisk.
5. Dersom flisene skal publiserast: sjå tilrådinga om statiske filer ovanfor, og legg `?kart` bak ein ekte konfigurasjon, ikkje dev-mellomvaren.
6. Søk Norge digitalt-avtale (eller vent på at Kartverket opnar FKB) om meir detaljerte bygg er ønskte.

## Publisering av fliser

Flisene er ein ferdig bygd artefakt: dei krev ca. 1 GB nedlasta Kartverket-data og tung OSM-henting, så dei blir ikkje bygde i CI. I staden ligg dei på grenen `tiles` (éin ny commit kvar gong, som `data`-grenen), og `deploy.yml` hentar dei til `public/kartverket-tiles/` før bygget. Utan grenen bygger sida likevel, men utan fliser.

Etter at du har bygd nye fliser lokalt (`npm run kartverket:tiles`, og `npm run kartverket:fine` for det fine terrenget som blir brukt frå bussetet; det ligg i mappa `fine/` på grenen):

```bash
npm run kartverket:publish   # pushar data-cache/tiles til grenen tiles
gh workflow run Publiser     # bygger og publiserer sida på nytt med dei nye flisene
```

Sida har to knappar, «Kartverket-kart» og «Terreng», som set flagga `?kart=kartverket` og `&terreng=1`. Standardkartet er framleis OSM.
