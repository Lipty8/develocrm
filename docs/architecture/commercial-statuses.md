# Obchodní status jednotky

Tento dokument uzavírá význam obchodních statusů před implementací bloků B–D. `unit_commercial_status` je čtecí projekce aktuálního obchodního výsledku, nikoli samostatně editovatelný formulářový údaj. RS, SBK a KS zůstávají typy smluv a milníky `sales_stage`; nejsou hodnotami obchodního statusu.

## Význam statusů

| Status | Jednoznačná podmínka |
| --- | --- |
| `available` | Jednotka je obchodovatelná a nemá aktivní předrezervaci, rezervaci, administrativní blokaci ani účinnou závaznou smlouvu. Historické zájmy nevadí. |
| `pre_reserved` | Existuje právě jedna aktivní časově omezená předrezervace a neexistuje aktivní rezervace ani účinná SBK/KS. |
| `reserved` | Existuje právě jedna aktivní rezervace, typicky podložená podepsanou RS, a neexistuje účinná SBK ani účinná KS. |
| `contracted` | Existuje účinná, neukončená SBK, ale dosud neexistuje účinná KS. Jednotka je smluvně zavázaná, právně-obchodní dokončení prodeje však ještě nenastalo. |
| `sold` | KS byla podepsána všemi povinnými stranami a doménovou operací `confirmFinalContractEffective` jí bylo nastaveno `effective_at`. Úhrada celé ceny, vklad do katastru a předání se reportují samostatně a nejsou podmínkou tohoto statusu. |
| `handed_over` | Existuje dokončené předání jednotky. Tento status může následovat pouze po `sold`; prodej zůstává současně dokončený. V reportingu se předané jednotky počítají jako prodané, pokud metrika výslovně neříká jinak. |
| `blocked` | Jednotka byla explicitně administrativně stažena z nabídky. Blokaci lze vytvořit jen bez účinné SBK/KS; původní stav a důvod se auditují. |

Rozdíl `contracted` vs. `sold` je tedy vždy stejný: `contracted` znamená účinnou SBK bez účinné KS, zatímco `sold` vyžaduje účinnou KS. Dashboard nesmí odvozovat tyto hodnoty pouze z názvu poslední nahrané smlouvy nebo ze stavu platby.

## Povolené přechody

- `available → pre_reserved`: `createPreReservation`
- `available → reserved`: `createReservation`
- `pre_reserved → available`: `expireHold` nebo `cancelPreReservation`
- `pre_reserved → reserved`: `confirmReservation`
- `reserved → available`: `expireHold` nebo `cancelReservation`, pouze pokud neexistuje účinná SBK/KS
- `reserved → contracted`: `activateFuturePurchaseContract` (účinná SBK)
- `contracted → sold`: `confirmFinalContractEffective` (účinná KS)
- `sold → handed_over`: `completeHandover`
- `available | pre_reserved | reserved → blocked`: `blockUnit`, pouze bez účinné SBK/KS
- `blocked → available`: `unblockUnit`, pokud mezitím nevznikla jiná překážka

Návrat z `contracted` nebo `sold` nikdy není obyčejná změna statusu. Je možný pouze kompenzační doménovou operací (například ukončením smlouvy) se zdůvodněním, oprávněním, auditem a novým přepočtem projekce.

## Invarianty a transakční pravidla

1. Neexistuje veřejný endpoint `PATCH unit.commercial_status`.
2. V jednu chvíli smí existovat nejvýše jeden aktivní hold (předrezervace nebo rezervace) na jednotku.
3. Aktivní hold nesmí koexistovat s účinnou SBK nebo KS.
4. Účinná KS má přednost před všemi nižšími stavy; účinná SBK má přednost před holdy.
5. `handed_over` vyžaduje dokončené předání a účinnou KS.
6. Každá doménová operace atomicky zapíše zdrojovou entitu, aktualizuje `sales_case`, přepočítá projekci jednotky, vytvoří auditní záznam a outbox událost.
7. Při porušení kteréhokoli invariantu se vrátí celá databázová transakce zpět.
8. Dashboardy a reporting čtou projekci, ale při změně ji nikdy samy nezapisují.

Konkrétní tabulky, constraints a transakční služby pro tyto stavy vzniknou až v blocích B a C.
