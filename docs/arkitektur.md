# Arkitektur

Diagram i [C4-modellen](https://c4model.com) på nivå 1 (kontekst) og nivå 2 (containerar), skrivne som Mermaid så dei vises rett på GitHub og følgjer endringar i git.
Dei viser korleis det er i dag. Kvifor det er slik står i [ADR-ane](adr/README.md), og kva som skjer når noko svikter står i [DRIFT.md](DRIFT.md).

Nivå 3 (komponentar) er ikkje teke med: koden er liten nok til at han ikkje gir meir enn han kostar å halde ved like.

**Teikn:** blå boksar er systemet vårt, grå er andre system, og sylindrar er stader der data ligg. Piler viser kven som kallar kven. På nivå 1 er stipla piler noko som skjer ved bygging eller publisering, ikkje når nokon brukar sida; på nivå 2 har bygginga eit eige diagram.

## Nivå 1: systemkontekst

Kven brukar systemet, og kva andre system er det avhengig av?

```mermaid
flowchart TB
    spelar(["Spelar<br/>[Person]<br/>Ser bussane i Oslo og Bærum<br/>som lys og modellar i eit 3D-kart"])

    subgraph oslobuss[" "]
        direction TB
        system["oslo-buss<br/>[Programvaresystem]<br/>3D-kart som viser Ruter-bussar<br/>no, med vêr, terreng og døgnrytme"]
    end

    entur["Entur<br/>[Eksternt system]<br/>Rutetabell (GTFS) og forseinking<br/>i sanntid (GTFS-RT). NLOD"]
    met["MET Norway<br/>[Eksternt system]<br/>Vêrvarsel for Oslo.<br/>CC BY 4.0 og NLOD"]
    kartverket["Kartverket<br/>[Eksternt system]<br/>Kartdata, terreng og høgder.<br/>CC BY 4.0"]
    osm["OpenStreetMap<br/>[Eksternt system]<br/>Bygningsomriss via Overpass.<br/>ODbL"]
    github["GitHub<br/>[Eksternt system]<br/>Kode, nattleg jobb<br/>og datagrener"]
    cloudflare["Cloudflare<br/>[Eksternt system]<br/>Køyrer Worker og<br/>Durable Object"]

    spelar -->|"Opnar sida,<br/>klikkar og går rundt"| system
    system -->|"Forseinking (maks kvart 15. sekund)<br/>og rutetabell (kvar natt)"| entur
    system -->|"Hentar vêret<br/>(bufra 30 minutt)"| met
    system -->|"Hentar tidstabell<br/>(kvar halvtime)"| github
    system -.->|"Kartfliser og terreng<br/>(ved bygging)"| kartverket
    system -.->|"Bygg<br/>(ved bygging)"| osm
    system -.->|"Publiserer tidstabell,<br/>kartfliser og ny versjon"| github
    system -.->|"Køyrer på"| cloudflare

    classDef person fill:#08427b,stroke:#052e56,color:#ffffff
    classDef sys fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef ext fill:#999999,stroke:#6b6b6b,color:#ffffff
    class spelar person
    class system sys
    class entur,met,kartverket,osm,github,cloudflare ext
    style oslobuss fill:none,stroke:none
```

## Nivå 2: containerar

Kva er dei køyrbare delane inne i systemet, og korleis snakkar dei saman? «Container» tyder her ein del som køyrer eller held data, ikkje Docker.
Nivå 2 er delt i to diagram for å vere lesbart: det som køyrer når nokon brukar sida, og det som bygger og publiserer.

### Når nokon brukar sida

```mermaid
flowchart TB
    spelar(["Spelar<br/>[Person]"])

    subgraph ob["oslo-buss"]
        direction TB
        nett["Nettlesar-app<br/>[TypeScript, three.js]<br/>3D-kartet: bussar, terreng, bygg,<br/>vêr og kamera. Held bussane<br/>i gong mellom svar"]
        worker["Worker<br/>[Cloudflare Worker]<br/>Serverer sida og sender live-stiane<br/>vidare. Hentar vêret. Korttidsbuffer:<br/>4 s for bussar, 30 min for vêr"]
        statisk[("Statiske filer<br/>[Workers Assets]<br/>Sida, bussmodellar og kartfliser")]
        feeds["Feeds<br/>[Durable Object, eitt for alle]<br/>Held tidstabellen, spør Entur,<br/>reknar ut kvar bussane er,<br/>svarar på /health"]
        lager[("Objektlager<br/>[Durable Object-lager]<br/>Gzippa kopi av tidstabellen og ETag")]
        datagren[("Grenen data<br/>[Git-gren på GitHub]<br/>Tidstabell og dei 7 siste<br/>som daterte filer")]
    end

    entur["Entur<br/>[Eksternt]<br/>Forseinking (GTFS-RT)"]
    met["MET Norway<br/>[Eksternt]<br/>Vêr"]

    spelar -->|"Bruker"| nett
    nett -->|"HTTPS: sida, /feeds/buses (kvart 15. s),<br/>/feeds/weather, /data/timetable.json"| worker
    worker -->|"Les filer"| statisk
    worker -->|"Kallar (idFromName main)"| feeds
    worker -->|"Vêr (bufra)"| met
    feeds -->|"TripUpdates, maks kvart 15. s"| entur
    feeds -->|"Tidstabell kvar halvtime, med ETag"| datagren
    feeds <-->|"Les og skriv"| lager

    classDef person fill:#08427b,stroke:#052e56,color:#ffffff
    classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
    classDef ext fill:#999999,stroke:#6b6b6b,color:#ffffff
    class spelar person
    class nett,worker,feeds,statisk,lager,datagren container
    class entur,met ext
    style ob fill:#f5f9fd,stroke:#1168bd,stroke-dasharray:5 5,color:#1168bd
```

### Bygging og publisering

Ingenting av dette køyrer når nokon brukar sida. Tidstabellen blir bygd kvar natt, kartflisene for hand, og sida ved push til `main`. Her viser pilene korleis data flyttar seg.

```mermaid
flowchart LR
    entur["Entur<br/>[Eksternt]<br/>Rutetabell (GTFS)"]
    natt["Tidstabellbygg<br/>[GitHub Action, nattleg]<br/>Byggjer og sjekkar tidstabellen"]
    datagren[("Grenen data<br/>[Git-gren]<br/>Tidstabell + 7 siste dagar")]

    kartverket["Kartverket<br/>[Eksternt]<br/>Kartdata og høgder"]
    osm["OpenStreetMap<br/>[Eksternt]<br/>Bygg via Overpass"]
    fliser["Fliseverktøy<br/>[Node.js-skript, lokalt]<br/>Byggjer kartfliser og terreng"]
    tilesgren[("Grenen tiles<br/>[Git-gren]<br/>Ferdige kartfliser")]
    deploy["Deploy-flyt<br/>[GitHub Action]<br/>Typesjekk, testar, bygg<br/>og publisering ved push til main"]
    statisk[("Statiske filer<br/>[Workers Assets]<br/>Sida og kartfliser")]
    cf["Cloudflare<br/>[Eksternt]<br/>Plattform"]

    entur -->|"GTFS, kvar natt"| natt
    natt -->|"Publiserer"| datagren

    kartverket -->|"Kartdata"| fliser
    osm -->|"Omriss"| fliser
    fliser -->|"Publiserer"| tilesgren
    tilesgren -->|"Hentar"| deploy
    deploy -->|"Lastar opp"| statisk
    deploy -->|"wrangler deploy"| cf

    classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
    classDef ext fill:#999999,stroke:#6b6b6b,color:#ffffff
    class natt,datagren,fliser,tilesgren,deploy,statisk container
    class entur,kartverket,osm,cf ext
```

### Kva diagrammet ikkje viser

- Kva Durable Object og Worker er i Azure-termar: sjå tabellen i [DRIFT.md](DRIFT.md).
- Kva som skjer når Entur eller GitHub svikter, og kva som er val med eit pris: [DRIFT.md](DRIFT.md) og [ADR-ane](adr/README.md).
- Kor posisjonane kjem frå: Entur gir forseinking, ikkje GPS. Utrekninga av kvar bussane er ligg i `Feeds` og i nettlesaren, sjå [ADR 0005](adr/0005-berekna-posisjonar.md).
