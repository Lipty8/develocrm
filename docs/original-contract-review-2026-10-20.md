# RS/SBK: vyplněné originálové návrhy a rozhodnutí o započtení poplatku

## Rozhodnutí Adama

20. 10. 2026 Adam výslovně rozhodl: **Ponechat pravidlo SBK a RS předat k právnímu sjednocení.**

- Zachovat současný centrální platební plán SBK: zaplacený rezervační poplatek + 20 % kupní ceny + doplatek 80 % minus poplatek.
- RS čl. III odst. 2 naproti tomu uvádí započtení proti první části ceny. Jde o otevřený obsahový rozpor pro právní kontrolu, nikoli pokyn agentovi přepsat právní text.
- Žádný platební předpis, transakce, alokace ani historický dokument se tímto balíkem nemění.
- RS návrh úmyslně zachovává původní větu. Nelze jej aktivovat jako smlouvu sjednocenou s platebním plánem, dokud nebude dodáno a schváleno příslušné právní znění.

## Co bylo skutečně ověřeno

Nový offline skript `backend/scripts/render-original-context-review.ts` sestaví explicitní syntetický `RsSource`, použije existující `buildOriginalContractSnapshot` a stávající striktní DOCX renderer. Nepřistupuje do DB ani Graphu, neschvaluje šablony a nevytváří smlouvy.

Výstupy v `outputs/contract-review/2026-10-20/`:

| Výstup | Pole | Odstavce | Strany | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| rs-technicky-vyplneny-ke-kontrole-2026-10-20.docx | 32 | 148 | 4 | 82b1677205009a3e3de8c0452e3725b7046b3124a78dcdb1949d292af3a30a05 |
| sbk-technicky-vyplneny-ke-kontrole-2026-10-20.docx | 37 | 261 | 11 | b5c9135e9a2e44513a7c2bb7070a89ac7611e2dbd78025f4662791023bffe447 |

Kontrola každého odstavce proti skutečnému originálu dovoluje pouze přesné úseky uvedené v již existujícím review manifestu. Jedinou změnou pevného popisku je dříve schválené RČ → Datum narození. Všechny ostatní části DOCX balíku jsou byte-for-byte zachované; struktura document.xml mimo textové uzly je shodná. Nezůstaly placeholdery ani nevyřešené technické značky.

Použita je jedna zjevně testovací fyzická osoba, kompletní varianta příslušenství a syntetická jednotka TECH-701. Cena 5 000 000,03 Kč záměrně ověřuje haléře: poplatek 250 000 Kč, 20 % = 1 000 000,01 Kč, doplatek = 3 750 000,02 Kč. Plánované podpisy 2./3. 11. 2026 nejsou skutečné podpisy ani počátek lhůty.

Všechny strany obou originálů i výsledků byly vykresleny a vizuálně zkontrolovány. Zachováno 4/11 stran, původní styly, zvýraznění, záhlaví/zápatí a podpisové linky. Delší testovací hodnoty přirozeně mění zalomení některých řádků. Nejde o právní posouzení ani o ověření v desktopovém Microsoft Wordu. Nativní Word pole nebyla přepisována uložením přes jiný editor; jejich aktualizaci je třeba potvrdit při obsahové kontrole ve Wordu.

## Testy a hranice důkazu

- 37/37 cílených testů: original-contract-snapshot, legal-template-review, original-payment-plan; žádné přeskočené testy. SQL numeric parity v této sadě běží v PGlite, nikoli v externím PostgreSQL serveru.
- Celý frontendový TypeScript typecheck: prošel.
- ESLint nového offline skriptu: prošel.
- Offline provedení skriptu: prošlo pro oba přesně hashované originály.
- Neproběhl nový živý upload ani browser E2E originálových šablon. Tento balík není důkazem produkční připravenosti právních smluv.

## Co brání aktivaci

1. Právní sjednocení uvedené věty RS se schváleným pravidlem SBK a výslovná obsahová kontrola nových parametrizovaných Wordů.
2. Schválené konkrétní přílohy a jejich verze: zdrojové Wordy obsahují seznamy příloh, nikoli celé přílohové balíky.
3. Tato varianta pokrývá jednu fyzickou osobu a kompletní příslušenství; jiné kombinace, firma a více kupujících potřebují odpovídající zkontrolovanou variantu.
4. Ověření pevných projektových právních údajů a podílu garáže. Texty se nesmějí vydávat za univerzální šablonu pro jiného developera.
5. Následné bezpečné runtime zapojení schváleného originálového profilu a živý E2E test. `generationSupported:false` a neaktivní draft stav nebyly změněny.

Změny jsou pouze offline ověřovací skript a dokumentace. Žádná migrace, změna pilotních dat ani nový deployment není pro tento balík potřebný.
