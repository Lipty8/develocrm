# RS/SBK — obsahové potvrzení Adama, 25. 10. 2026

## Přímé rozhodnutí uživatele

„rs i sbk nech tak jak jsou napsané - jsou od právníka

potvrzuji parametrizované wordy a potvrzuji kompletní přílohový balík“

Toto je nově dodané obsahové potvrzení. Předchozí stav „čeká na obsahové
schválení parametrizovaných Wordů“ již nelze nadále vydávat za chybějící
rozhodnutí uživatele. Právní text RS ani SBK se nemá měnit ani harmonizovat
vlastním textem vývojáře. Rozhodnutí se týká již předložené kompletní varianty
Dejvice s datem narození, nikoli libovolných budoucích variant či jiných tenantů.

## Přesně předložené Wordy

Otisky byly znovu ověřeny při přijetí potvrzení:

| Soubor | SHA-256 |
| --- | --- |
| `outputs/contract-review/2026-10-20/rs-technicky-vyplneny-ke-kontrole-2026-10-20.docx` | `82b1677205009a3e3de8c0452e3725b7046b3124a78dcdb1949d292af3a30a05` |
| `outputs/contract-review/2026-10-20/sbk-dorucovani-v2-ke-kontrole-2026-10-20.docx` | `f05c87ceddaf7befc711ebe13bea3b0ad8ace40988d55d94ff8c2199ec28e634` |

Odpovídající parametrizované zdroje (nikoli vyplněné technické ukázky k uploadu):

- RS, 32 polí: `backend/templates/review/rs-dejvice-original-review.docx`,
  SHA-256 `6d5265703063e33632450921cfeac1388a7004ec6483bf7149e4ee9f89b50886`.
- SBK doručování v2, 38 polí:
  `backend/templates/review/sbk-dejvice-original-delivery-review.docx`,
  SHA-256 `2d320d0331e0c17f9d3e37c601420b54077da53f2e99eb0b2b0be0d51774af50`.

Původní review manifesty zůstávají historickým záznamem přípravy. Jejich příznak
draft se nesmí zpětně přepsat tak, jako by schválení existovalo dříve. Tato
dokumentace také nenahrazuje autorizovaný schvalovací lifecycle konkrétní
neměnné verze v CRM ani audit/outbox této operace.

## Hranice potvrzení a další provedení

- Schválení obsahu je přijato; nikdo nemá znovu žádat stejné obecné schválení.
- Zachovat dosavadní finanční model a dříve výslovně zvolené pravidlo SBK.
  Z potvrzení Wordů neodvozovat vlastní změnu alokací, splátek či vratek.
  Dříve popsaný rozdíl formulací zůstává dokumentovaným faktem, nikoli oprávněním
  přepsat právní větu. Neprohlašovat, že obsahový rozpor byl právně odstraněn.
- Přílohový balík je uživatelem obsahově potvrzen. Technicky je stále třeba
  jednoznačně určit skutečné soubory/verze pro každou požadovanou pozici.
  Soubor se situacemi parkingu/sklepů se nesmí bez důkazu označit za koordinační
  situaci; potvrzení balíku nedodává chybějící soubor ani konkrétní vazbu.
- Dřívější bezpečnostní zastavení u PDF standardů se neobchází. Nově načtená
  metadata potvrzují existenci souboru (10 183 053 bajtů), nikoli antivirovou
  nezávadnost. Metadata situací potvrzují 734 142 bajtů. V této kontrole nebyl
  žádný z těchto souborů nově zaregistrován ani přiřazen ke smlouvě.
- Následuje technické zpřístupnění RS profilu při zachování explicitního
  schválení každé DB verze, otestování, matching nasazení a autorizovaná aktivace
  přesného projektového zdroje. Starší SBK 37 polí se nenahrazuje doručovací v2
  tiše. Nevytvářet druhý template, document ani upload systém.
- Žádná změna reálných obchodů, ploch, cen nebo podepsaných dokumentů není
  tímto potvrzením autorizována. Samotný tento záznam nic neaktivuje ani nenasazuje.
