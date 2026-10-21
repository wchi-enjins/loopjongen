# Benchmark: wetten zoeken (2026-10-09)

- **Model:** claude-opus-5-5, effort low
- **Vragen:** 21 (questions.json)

| Aanpak | n | law@1 | law@5 | artikel-recall | gem. tijd | gem. kosten | fouten |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b-then-a | 21 | 81% | 90% | 83% | 12s | $0.088 | 0 |

## Backend-belasting (gemiddeld per vraag)

| Aanpak | CPU backend | geheugen backend (piek) | CPU Postgres | schijf gelezen Postgres | geheugen Postgres | calls overheid.nl | wachttijd overheid.nl |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b-then-a | 103 ms | 162 MB | 490 ms | 0.1 MB | 1343 MB | 1.1 | 0.1 s |

## Per moeilijkheid

| Aanpak | n | law@1 | law@5 | artikel-recall | gem. tijd | gem. kosten | fouten |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b-then-a / obscure | 10 | 60% | 80% | 70% | 15s | $0.137 | 0 |
| b-then-a / common | 5 | 100% | 100% | 90% | 8s | $0.043 | 0 |
| b-then-a / mid | 6 | 100% | 100% | 100% | 8s | $0.045 | 0 |

## Tuchtrecht (Marine BWBR0003866 vs. Landmacht BWBR0003865)

| Aanpak | Vraag | Uitkomst | artikel-recall |
| --- | --- | --- | --- |
| b-then-a | tuchtrecht-km-bewaartermijn | Landmacht #1 boven Marine | 100% |
| b-then-a | tuchtrecht-km-correctie | Marine #1 | 100% |
| b-then-a | tuchtrecht-km-verstrekking-toegang | Marine #1 | 100% |

## Per vraag

| Vraag | Moeilijkheid | Gold | b-then-a: top 3 / recall |
| --- | --- | --- | --- |
| tuchtrecht-km-bewaartermijn | obscure | BWBR0003866 10 | 🟡 BWBR0003865, BWBR0003866 / 100% |
| tuchtrecht-km-correctie | obscure | BWBR0003866 8,1 | ✅ BWBR0003866, BWBR0003865 / 100% |
| tuchtrecht-km-verstrekking-toegang | obscure | BWBR0003866 5,6,2 | ✅ BWBR0003866 / 100% |
| huur-opzegging-huurder | common | BWBR0005290 271 | ✅ BWBR0005290, BWBR0028752 / 100% |
| awb-bezwaartermijn | common | BWBR0005537 6:7,6:8 | ✅ BWBR0005537 / 50% |
| sr-diefstal-strafmaximum | common | BWBR0001854 310 | ✅ BWBR0001854, BWBR0039092, BWBR0053174 / 100% |
| rv-kantonrechter-competentie | common | BWBR0001827 93 | ✅ BWBR0001827, BWBR0028899 / 100% |
| arbeid-proeftijd-vast-contract | common | BWBR0005290 652 | ✅ BWBR0005290, BWBR0028752 / 100% |
| arbeid-dagelijkse-rusttijd | mid | BWBR0007671 5:3 | ✅ BWBR0007671, BWBR0007687 / 100% |
| medezeggenschap-camera-instemming | mid | BWBR0002747 27 | ✅ BWBR0002747, BWBR0037591, BWBR0042812 / 100% |
| vakantiebijslag-minimum | mid | BWBR0002638 15 | ✅ BWBR0002638 / 100% |
| geboorteverlof-partner | mid | BWBR0013008 4:2 | ✅ BWBR0013008, BWBR0005290 / 100% |
| winkel-zondag-feestdag | mid | BWBR0007952 2,3 | ✅ BWBR0007952, BWBR0028197, BWBR0002120 / 100% |
| huurcommissie-leges-voorschot | mid | BWBR0014315 7 | ✅ BWBR0014315, BWBR0003237, BWBR0015386 / 100% |
| gedetineerde-uitvaart-verlof | obscure | BWBR0010171 24,21 | ✅ BWBR0010171, BWBR0042962 / 100% |
| lesmotor-lesaanduiding | obscure | BWBR0008048 1,2,3 | ❌ BWBR0025798, BWBR0025890, BWBR0006073 / 0% |
| pluimvee-sterfte-melden | obscure | BWBR0035248 3a.2 | 🟡 BWBR0045051, BWBR0035248, BWBR0035217 / 100% |
| belasting-afschrijving-betaalrekening | obscure | BWBR0004766 1ce | ✅ BWBR0004766, BWBR0004770 / 0% |
| diplomaat-persoonsgegevens-inzage | obscure | BWBR0014172 10,11 | ❌ BWBR0040940 / 0% |
| zwangerschapsuitkering-spreekuur-verhuizing | obscure | BWBR0020117 5,7 | ✅ BWBR0020117 / 100% |
| tattoo-vergunning-duur-kosten | obscure | BWBR0021915 3,5 | ✅ BWBR0021915, BWBR0021605, BWBR0021917 / 100% |
