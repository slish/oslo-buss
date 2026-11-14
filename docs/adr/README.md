# Arkitekturavgjerder (ADR)

Kvar fil her skildrar ei avgjerd: samanhengen ho blei teken i, alternativa, kva som blei valt, og kva det kostar og gir. Dei er skrivne i
ettertid (14. november 2026) for val som alt var gjort i koden, og fylgjer [MADR](https://adr.github.io/madr/) med eit par felt som trengst
for å kunne vurdere avgjerda på nytt. Statusen er **Akseptert** når avgjerda gjeld i dag.

| Nr | Avgjerd | Status |
|---|---|---|
| [0001](0001-eitt-durable-object.md) | Eitt Durable Object som einaste Entur-klient | Akseptert |
| [0002](0002-ope-api.md) | Ope API utan autentisering og utan rate limiting | Akseptert |
| [0003](0003-github-som-datalager.md) | GitHub-grener som datalager for tidstabell og kartfliser | Akseptert |
| [0004](0004-direkte-deploy.md) | Direkte deploy til produksjon ved push til `main` | Akseptert |
| [0005](0005-berekna-posisjonar.md) | Berekna posisjonar, og korleis dei blir merkte | Akseptert |
| [0006](0006-cloudflare-workers.md) | Cloudflare Workers som plattform | Akseptert |
| [0007](0007-omfang.md) | Omfang og prioritering | Akseptert |
| [0008](0008-bruk-av-ki.md) | Bruk av KI i utviklinga | Akseptert |

Ny avgjerd: kopier [malen](0000-mal.md), gi ho neste nummer, og legg ho i tabellen. Ei avgjerd blir ikkje sletta når ho blir endra; ho får
status **Erstatta av 00NN**, og den nye viser attende til henne.
