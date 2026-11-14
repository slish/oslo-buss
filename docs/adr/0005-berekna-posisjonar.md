# 0005. Berekna posisjonar, og korleis dei blir merkte

- **Status:** Akseptert
- **Dato:** 2026-11 (dokumentert 2026-11-14)
- **Skrive i ettertid:** ja

## Kontekst

Prosjektet viser bussar som punkt og modellar i eit kart. Entur sin sanntidsfeed (GTFS-RT TripUpdates) gir forseinking per turn og haldeplass, men
ingen GPS-posisjonar: Ruter sender ikkje slike til Entur (README, «Posisjonar er berekna, ikkje målte»). Bussane må difor plasserast av oss.

## Avgjerdsdrivarar

- Eit levande kart er heile poenget, så bussane må vere på vegen no.
- Ikkje late som om berekna posisjonar er målte. Det er ei tillitssak for dei som les panelet.
- Data må vere opne og brukbare utan avtale.
- Éin felles utrekning som tenesta og nettlesaren er samde om.

## Alternativ

### A. Berekna posisjonar frå rutetabell og målt forseinking (valt)

- Fordelar: Ei konsistent og forklarbar utrekning (`src/shared/position.ts`). Fungerer for alle turar i tidstabellen. Entur sine data er opne.
- Ulemper: Bussen er ikkje der den verkeleg er: han står ikkje i kø eller lyskryss, og han står stille ved haldeplass frå ankomst til avgang.

### B. Målte posisjonar frå ein annan kjelde

- Fordelar: Ekte stad.
- Ulemper: Ikkje tilgjengeleg som opne data frå Ruter via Entur slik tenesta er sett opp. Ville krevd avtale eller ei anna kjelde.

### C. Berre rutetabellen, utan forseinking

- Fordelar: Enklast.
- Ulemper: Bussane ville vore feil heile tida i rushet.

### D. Berre bussar med målt forseinking

- Fordelar: Alt som blir vist er støtta av ei måling.
- Ulemper: Kartet blir tomt for mange linjer og tidspunkt.

## Avgjerd

**Alternativ A.** Posisjonen blir rekna ut frå rutetabellen og forseinkinga Entur måler. Nettlesaren held bussane i gong mellom svara (kvart 15. sekund) og trekker dei mjukt mot nytt svar.

Merkinga av dette er ein del av avgjerda:
- Infopanelet seier **«Forseinking frå Entur sanntid, posisjon berekna etter rutetabell»** for bussar med målt forseinking, og «Etter rutetabell (ingen sanntidsdata)» elles.
- Botnteksten og README seier at posisjonane er modellerte.
- Før 14. november 2026 sto det «Sanntid frå Entur» i panelet, noko som lét posisjonen sjå målt ut. Det blei endra.

## Konsekvensar

**Positive:**
- Alle turar kan visast, også dei utan sanntidsdata.
- Utrekninga er rein (tek tidstabell og oppdateringar, hentar ingenting) og dermed testbar.
- Ærleg merking gir mindre risiko for feil tillit til kartet.

**Negative, og kva vi gjer med dei:**
- Ein buss kan stå på feil stad i høve til verkelegheita, særleg i rushet. Dokumentert som avgrensing i README.
- Panelteksten er lengre enn «Sanntid». Prisen er verd det.

## Vurder på nytt når

- Ruter eller Entur gjer køyretøyposisjonar opne. Då kan utrekninga erstattast eller samanliknast med målte posisjonar.

## Relatert

[0001](0001-eitt-durable-object.md), `src/shared/position.ts`, `src/relay/buses.ts`, README «Avgrensingar og kjende ting».
