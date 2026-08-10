export type PermissionOperation = "view" | "create" | "update" | "review" | "approve" | "record" | "import" | "export" | "archive" | "assign" | "manage";
export type PermissionScope = "workspace" | "project" | "own" | "agency";

export type PermissionDefinition = {
  key: string;
  name: string;
  description: string;
  category: string;
  operation: PermissionOperation;
  supportedScopes: PermissionScope[];
  systemRestriction?: string;
};

const workspace: PermissionScope[] = ["workspace"];
const project: PermissionScope[] = ["workspace", "project"];
const clientScope: PermissionScope[] = ["workspace", "project", "own", "agency"];

const definitions: PermissionDefinition[] = [
  {key:"tenant.read",name:"Zobrazit pracovní prostor",description:"Uživatel uvidí základní údaje a nastavení pracovního prostoru.",category:"Systém",operation:"view",supportedScopes:workspace},
  {key:"tenant.manage",name:"Spravovat pracovní prostor",description:"Uživatel může měnit základní nastavení pracovního prostoru.",category:"Systém",operation:"manage",supportedScopes:workspace,systemRestriction:"Pouze správci pracovního prostoru."},
  {key:"membership.read",name:"Zobrazit uživatele",description:"Uživatel uvidí členy pracovního prostoru a jejich přístupy.",category:"Uživatelé a role",operation:"view",supportedScopes:workspace},
  {key:"membership.invite",name:"Přidávat uživatele",description:"Uživatel může pozvat nového uživatele do pracovního prostoru.",category:"Uživatelé a role",operation:"create",supportedScopes:workspace},
  {key:"membership.manage",name:"Spravovat členství uživatelů",description:"Uživatel může aktivovat, pozastavit nebo archivovat přístup uživatele.",category:"Uživatelé a role",operation:"manage",supportedScopes:workspace},
  {key:"users.manage",name:"Spravovat uživatele",description:"Uživatel může spravovat uživatele, jejich stav a přiřazené role.",category:"Uživatelé a role",operation:"manage",supportedScopes:workspace},
  {key:"role.read",name:"Zobrazit role a oprávnění",description:"Uživatel uvidí role a jejich přidělená oprávnění.",category:"Uživatelé a role",operation:"view",supportedScopes:workspace},
  {key:"role.manage",name:"Spravovat vlastní role",description:"Uživatel může vytvářet, upravovat a archivovat vlastní role.",category:"Uživatelé a role",operation:"manage",supportedScopes:workspace},
  {key:"role.assign",name:"Přiřazovat role uživatelům",description:"Uživatel může přiřazovat role členům pracovního prostoru.",category:"Uživatelé a role",operation:"assign",supportedScopes:workspace},
  {key:"roles.manage",name:"Spravovat role a oprávnění",description:"Uživatel může měnit oprávnění rolí při zachování systémových omezení.",category:"Uživatelé a role",operation:"manage",supportedScopes:workspace,systemRestriction:"Systémová omezení rolí nelze odebrat."},

  {key:"project.read",name:"Zobrazit projekty",description:"Uživatel uvidí projekty a jejich strukturu v povoleném rozsahu.",category:"Projekty",operation:"view",supportedScopes:project},
  {key:"projects.read",name:"Zobrazit projekty",description:"Uživatel uvidí projekty a jejich základní údaje v povoleném rozsahu.",category:"Projekty",operation:"view",supportedScopes:project},
  {key:"projects.create",name:"Zakládat projekty",description:"Uživatel může založit nový projekt v pracovním prostoru a nastavit jeho základní údaje.",category:"Projekty",operation:"create",supportedScopes:workspace},
  {key:"project.manage",name:"Spravovat projekty",description:"Uživatel může spravovat základní údaje a strukturu projektů.",category:"Projekty",operation:"manage",supportedScopes:project},
  {key:"projects.update",name:"Upravovat projekty",description:"Uživatel může upravovat základní údaje přiřazených projektů.",category:"Projekty",operation:"update",supportedScopes:project},
  {key:"projects.change_manager",name:"Měnit vedoucího projektu",description:"Uživatel může změnit odpovědného vedoucího projektu.",category:"Projekty",operation:"update",supportedScopes:project},
  {key:"projects.change_status",name:"Měnit fázi projektu",description:"Uživatel může zapsat povolenou změnu fáze projektu.",category:"Projekty",operation:"update",supportedScopes:project},
  {key:"structure.manage",name:"Spravovat strukturu projektu",description:"Uživatel může spravovat etapy, budovy a sekce projektu.",category:"Projekty",operation:"manage",supportedScopes:project},
  {key:"construction_status.manage",name:"Měnit stavební stav",description:"Uživatel může zapisovat stavební stav projektu a jeho struktur.",category:"Projekty",operation:"update",supportedScopes:project},
  {key:"media.read",name:"Zobrazit projektová média",description:"Uživatel uvidí projektové obrázky a půdorysy jednotek.",category:"Projekty",operation:"view",supportedScopes:project},
  {key:"media.manage",name:"Spravovat projektová média",description:"Uživatel může přidávat a měnit projektové obrázky a půdorysy.",category:"Projekty",operation:"manage",supportedScopes:project},

  {key:"unit.read",name:"Zobrazit jednotky",description:"Uživatel uvidí jednotky v projektech, ke kterým má přístup.",category:"Jednotky a příslušenství",operation:"view",supportedScopes:project},
  {key:"units.read",name:"Zobrazit jednotky",description:"Uživatel uvidí jednotky v projektech, ke kterým má přístup.",category:"Jednotky a příslušenství",operation:"view",supportedScopes:project},
  {key:"unit.manage",name:"Spravovat jednotky",description:"Uživatel může upravovat parametry jednotek v povoleném rozsahu.",category:"Jednotky a příslušenství",operation:"manage",supportedScopes:project},
  {key:"units.update",name:"Upravovat jednotky",description:"Uživatel může upravovat základní údaje a parametry jednotek.",category:"Jednotky a příslušenství",operation:"update",supportedScopes:project},
  {key:"commercial_status.manage",name:"Měnit obchodní stav jednotek",description:"Uživatel může provádět povolené obchodní přechody jednotek.",category:"Jednotky a příslušenství",operation:"update",supportedScopes:project},
  {key:"units.update_sales_status",name:"Měnit obchodní stav jednotek",description:"Uživatel může měnit povolené obchodní stavy jednotek v rozsahu přiřazených projektů.",category:"Jednotky a příslušenství",operation:"update",supportedScopes:project},
  {key:"accessory.read",name:"Zobrazit příslušenství",description:"Uživatel uvidí příslušenství jednotek v povolených projektech.",category:"Jednotky a příslušenství",operation:"view",supportedScopes:project},
  {key:"accessories.read",name:"Zobrazit příslušenství",description:"Uživatel uvidí sklepy, parkovací stání, wallboxy a další příslušenství.",category:"Jednotky a příslušenství",operation:"view",supportedScopes:project},
  {key:"accessory.manage",name:"Spravovat příslušenství",description:"Uživatel může spravovat příslušenství a jeho přiřazení jednotkám.",category:"Jednotky a příslušenství",operation:"manage",supportedScopes:project},
  {key:"accessories.update",name:"Upravovat příslušenství",description:"Uživatel může upravovat a přiřazovat příslušenství jednotek.",category:"Jednotky a příslušenství",operation:"update",supportedScopes:project},

  {key:"clients.read",name:"Zobrazit klienty",description:"Uživatel uvidí klienty a zájemce v povoleném rozsahu.",category:"Klienti",operation:"view",supportedScopes:clientScope},
  {key:"clients.read_all",name:"Zobrazit všechny klienty",description:"Uživatel uvidí všechny klienty v projektech, ke kterým má přístup.",category:"Klienti",operation:"view",supportedScopes:["workspace","project"]},
  {key:"clients.read_own",name:"Zobrazit vlastní klienty",description:"Uživatel uvidí pouze klienty, za které odpovídá.",category:"Klienti",operation:"view",supportedScopes:["own","agency"]},
  {key:"clients.read_contact_details",name:"Zobrazit kontaktní údaje klientů",description:"Uživatel uvidí telefon, e-mail a adresní údaje dostupných klientů.",category:"Klienti",operation:"view",supportedScopes:clientScope},
  {key:"clients.create",name:"Přidávat klienty",description:"Uživatel může založit nového klienta nebo zájemce.",category:"Klienti",operation:"create",supportedScopes:clientScope},
  {key:"clients.update",name:"Upravovat klienty",description:"Uživatel může upravovat údaje dostupných klientů a jejich kontakty.",category:"Klienti",operation:"update",supportedScopes:clientScope},
  {key:"clients.manage",name:"Spravovat klienty",description:"Uživatel může spravovat canonical záznamy klientů, kontakty a vazby.",category:"Klienti",operation:"manage",supportedScopes:clientScope},
  {key:"clients.export",name:"Exportovat kontakty klientů",description:"Uživatel může exportovat kontakty klientů v povoleném rozsahu.",category:"Exporty a audit",operation:"export",supportedScopes:clientScope},
  {key:"interests.manage",name:"Spravovat historii zájmu",description:"Uživatel může zapisovat a aktualizovat historii zájmu o jednotky.",category:"Klienti",operation:"manage",supportedScopes:project},
  {key:"client_changes.read",name:"Zobrazit klientské změny",description:"Uživatel uvidí požadavky klientů na změny jednotek v povolených projektech.",category:"Klientské změny",operation:"view",supportedScopes:project},
  {key:"client_changes.manage",name:"Spravovat klientské změny",description:"Uživatel může vytvářet a bezpečně archivovat klientské změny v povolených projektech.",category:"Klientské změny",operation:"manage",supportedScopes:project},

  {key:"sales_case.read",name:"Zobrazit obchodní případy",description:"Uživatel uvidí obchodní kontext jednotek v povoleném rozsahu.",category:"Obchodní případy",operation:"view",supportedScopes:project},
  {key:"sales_cases.read",name:"Zobrazit obchodní případy",description:"Uživatel uvidí obchodní případy v přiřazených projektech.",category:"Obchodní případy",operation:"view",supportedScopes:project},
  {key:"sales_case.manage",name:"Spravovat obchodní případy",description:"Uživatel může spravovat obchodní případy a jejich účastníky.",category:"Obchodní případy",operation:"manage",supportedScopes:project},
  {key:"sales_cases.manage",name:"Spravovat obchodní případy",description:"Uživatel může spravovat obchodní případy a více kupujících.",category:"Obchodní případy",operation:"manage",supportedScopes:project},
  {key:"holds.create",name:"Vytvářet předrezervace",description:"Uživatel může vytvořit předrezervaci jednotky podle obchodních pravidel.",category:"Obchodní případy",operation:"create",supportedScopes:project},
  {key:"holds.confirm",name:"Potvrzovat rezervace",description:"Uživatel může převést předrezervaci na potvrzenou rezervaci.",category:"Obchodní případy",operation:"approve",supportedScopes:project},
  {key:"holds.cancel",name:"Rušit předrezervace a rezervace",description:"Uživatel může řízeně zrušit nebo uvolnit aktivní obchodní blokaci.",category:"Obchodní případy",operation:"update",supportedScopes:project},
  {key:"holds.manage",name:"Spravovat rezervace",description:"Uživatel může vytvářet, převádět, rušit a expirovat rezervace.",category:"Obchodní případy",operation:"manage",supportedScopes:project},

  {key:"contract.read",name:"Zobrazit smlouvy",description:"Uživatel uvidí smlouvy, jejich účastníky a verze.",category:"Smlouvy",operation:"view",supportedScopes:project},
  {key:"contracts.read",name:"Zobrazit smlouvy",description:"Uživatel uvidí smlouvy v projektech, ke kterým má přístup.",category:"Smlouvy",operation:"view",supportedScopes:project},
  {key:"contracts.create",name:"Přidávat smlouvy",description:"Uživatel může založit novou smlouvu v obchodním případu.",category:"Smlouvy",operation:"create",supportedScopes:project},
  {key:"contract.manage",name:"Spravovat smlouvy",description:"Uživatel může spravovat smlouvy a jejich pracovní verze.",category:"Smlouvy",operation:"manage",supportedScopes:project},
  {key:"contracts.update",name:"Upravovat smlouvy",description:"Uživatel může upravovat smlouvy a provádět povolené změny workflow.",category:"Smlouvy",operation:"update",supportedScopes:project},
  {key:"contracts.mark_ready",name:"Označit smlouvu jako připravenou",description:"Uživatel může potvrdit formální připravenost smlouvy k dalšímu kroku.",category:"Smlouvy",operation:"review",supportedScopes:project},
  {key:"contract.approve",name:"Schvalovat smlouvy k podpisu",description:"Uživatel může schválit připravenou verzi smlouvy k podpisu.",category:"Smlouvy",operation:"approve",supportedScopes:project},
  {key:"contract.sign",name:"Zaznamenat podpis smlouvy",description:"Uživatel může zaznamenat podpis smlouvy a podepisujících stran.",category:"Smlouvy",operation:"record",supportedScopes:project},
  {key:"contracts.record_signature",name:"Zaznamenat podpis smlouvy",description:"Uživatel může zaznamenat skutečný podpis smlouvy bez změny podepsané verze.",category:"Smlouvy",operation:"record",supportedScopes:project},

  {key:"documents.view",name:"Zobrazit dokumenty",description:"Uživatel uvidí metadata, vazby a odkazy dostupných dokumentů.",category:"Dokumenty",operation:"view",supportedScopes:project},
  {key:"documents.read",name:"Zobrazit dokumenty",description:"Uživatel uvidí dokumenty v povolených projektech.",category:"Dokumenty",operation:"view",supportedScopes:project},
  {key:"documents.view_sensitive",name:"Zobrazit citlivé dokumenty",description:"Uživatel uvidí citlivé klientské a smluvní dokumenty.",category:"Dokumenty",operation:"view",supportedScopes:project,systemRestriction:"Přístup podléhá citlivosti dokumentu."},
  {key:"documents.create",name:"Přidávat dokumenty",description:"Uživatel může založit metadata nového dokumentu.",category:"Dokumenty",operation:"create",supportedScopes:project},
  {key:"documents.upload",name:"Nahrávat verze dokumentů",description:"Uživatel může přidat fyzickou verzi dokumentu do připojeného úložiště.",category:"Dokumenty",operation:"create",supportedScopes:project},
  {key:"documents.edit_metadata",name:"Upravovat metadata dokumentů",description:"Uživatel může upravovat název, typ, stav a vazby dokumentu.",category:"Dokumenty",operation:"update",supportedScopes:project},
  {key:"documents.update",name:"Upravovat dokumenty",description:"Uživatel může upravovat dostupné dokumenty a jejich metadata.",category:"Dokumenty",operation:"update",supportedScopes:project},
  {key:"documents.review",name:"Kontrolovat dokumenty",description:"Uživatel může provést formální kontrolu připravenosti dokumentu.",category:"Dokumenty",operation:"review",supportedScopes:project},
  {key:"documents.manage",name:"Spravovat vazby dokumentů",description:"Uživatel může spravovat vazby dokumentů a připojení úložiště.",category:"Dokumenty",operation:"manage",supportedScopes:project},
  {key:"documents.archive",name:"Archivovat dokumenty",description:"Uživatel může archivovat dokument bez ztráty historie a verzí.",category:"Dokumenty",operation:"archive",supportedScopes:project},

  {key:"price.read",name:"Zobrazit ceny",description:"Uživatel uvidí aktuální ceny a jejich historii.",category:"Ceny",operation:"view",supportedScopes:project},
  {key:"prices.read",name:"Zobrazit ceny",description:"Uživatel uvidí ceny jednotek v povoleném rozsahu.",category:"Ceny",operation:"view",supportedScopes:project},
  {key:"price.manage",name:"Zapisovat změny cen",description:"Uživatel může přidávat nové záznamy do historie cen.",category:"Ceny",operation:"update",supportedScopes:project},
  {key:"prices.change",name:"Zapisovat platné změny cen",description:"Uživatel může zaznamenat schválenou změnu ceny s účinností a důvodem.",category:"Ceny",operation:"update",supportedScopes:project},
  {key:"prices.propose",name:"Navrhovat změny cen",description:"Uživatel může předložit návrh změny ceny ke schválení.",category:"Ceny",operation:"create",supportedScopes:project},
  {key:"price.approve",name:"Schvalovat ceny a slevy",description:"Uživatel může schvalovat navržené ceny a smluvní cenové odchylky.",category:"Ceny",operation:"approve",supportedScopes:project},
  {key:"prices.approve",name:"Schvalovat ceny",description:"Uživatel může schvalovat návrhy změn cen.",category:"Ceny",operation:"approve",supportedScopes:project},
  {key:"discounts.approve",name:"Schvalovat slevy",description:"Uživatel může schvalovat individuální slevy.",category:"Ceny",operation:"approve",supportedScopes:project},
  {key:"commercial_exceptions.approve",name:"Schvalovat obchodní výjimky",description:"Uživatel může schvalovat odchylky od standardních obchodních pravidel.",category:"Obchodní výjimky",operation:"approve",supportedScopes:project},

  {key:"finance.read",name:"Zobrazit finanční agendu",description:"Uživatel uvidí platební a finanční přehledy.",category:"Platby",operation:"view",supportedScopes:project},
  {key:"payments.read",name:"Zobrazit platby",description:"Uživatel uvidí platební předpisy a skutečné úhrady.",category:"Platby",operation:"view",supportedScopes:project},
  {key:"payments.reservation_status",name:"Zobrazit stav rezervačního poplatku",description:"Uživatel uvidí pouze informaci o stavu rezervačního poplatku.",category:"Platby",operation:"view",supportedScopes:project},
  {key:"finance.manage",name:"Spravovat finanční agendu",description:"Uživatel může spravovat platební a finanční agendu.",category:"Platby",operation:"manage",supportedScopes:project},
  {key:"payments.manage",name:"Spravovat platební předpisy",description:"Uživatel může vytvářet a upravovat platební předpisy.",category:"Platby",operation:"manage",supportedScopes:project},
  {key:"payments.record",name:"Evidovat a párovat platby",description:"Uživatel může zaznamenat skutečnou úhradu a přiřadit ji k předpisu.",category:"Platby",operation:"record",supportedScopes:project},
  {key:"payments.reverse",name:"Reverzovat platby",description:"Uživatel může provést auditovatelnou reverzaci chybné úhrady.",category:"Platby",operation:"update",supportedScopes:project},
  {key:"payments.import",name:"Importovat bankovní výpisy",description:"Uživatel může importovat bankovní výpis a potvrdit navržená párování.",category:"Platby",operation:"import",supportedScopes:project},
  {key:"payments.export",name:"Exportovat finanční přehledy",description:"Uživatel může exportovat platební přehledy v povoleném rozsahu.",category:"Exporty a audit",operation:"export",supportedScopes:project},

  {key:"handover.read",name:"Zobrazit předání",description:"Uživatel uvidí termíny, připravenost a nedodělky předání.",category:"Předání",operation:"view",supportedScopes:project},
  {key:"handovers.read",name:"Zobrazit předání",description:"Uživatel uvidí plánovaná a dokončená předání jednotek.",category:"Předání",operation:"view",supportedScopes:project},
  {key:"handover.manage",name:"Spravovat předání",description:"Uživatel může plánovat a řídit předání jednotek.",category:"Předání",operation:"manage",supportedScopes:project},
  {key:"handovers.manage",name:"Spravovat předání",description:"Uživatel může plánovat předání a měnit jejich připravenost.",category:"Předání",operation:"manage",supportedScopes:project},
  {key:"complaints.read",name:"Zobrazit reklamace",description:"Uživatel uvidí reklamace a jejich aktuální stav.",category:"Reklamace",operation:"view",supportedScopes:project},
  {key:"complaints.manage",name:"Spravovat reklamace",description:"Uživatel může zapisovat, řešit a uzavírat reklamace.",category:"Reklamace",operation:"manage",supportedScopes:project},
  {key:"tasks.read",name:"Zobrazit úkoly",description:"Uživatel uvidí úkoly v povoleném rozsahu.",category:"Úkoly",operation:"view",supportedScopes:project},
  {key:"tasks.manage",name:"Spravovat úkoly",description:"Uživatel může vytvářet, upravovat a dokončovat úkoly.",category:"Úkoly",operation:"manage",supportedScopes:project},

  {key:"system.manage",name:"Spravovat systémová nastavení",description:"Uživatel může měnit provozní nastavení pracovního prostoru.",category:"Systém",operation:"manage",supportedScopes:workspace,systemRestriction:"Vyhrazeno provozním administrátorům."},
  {key:"integrations.manage",name:"Spravovat integrace",description:"Uživatel může nastavovat připojení externích služeb.",category:"Systém",operation:"manage",supportedScopes:workspace,systemRestriction:"Vyhrazeno provozním administrátorům."},
  {key:"exports.run",name:"Exportovat data",description:"Uživatel může spouštět povolené datové exporty.",category:"Exporty a audit",operation:"export",supportedScopes:["workspace","project"]},
  {key:"audit.read",name:"Zobrazit auditní záznamy",description:"Uživatel uvidí auditní historii změn v povoleném rozsahu.",category:"Exporty a audit",operation:"view",supportedScopes:["workspace","project"]},
];

export const permissionCatalog: Readonly<Record<string, PermissionDefinition>> = Object.freeze(
  Object.fromEntries(definitions.map(definition => [definition.key, Object.freeze(definition)])),
);

export const permissionCategoryOrder = [
  "Projekty",
  "Jednotky a příslušenství",
  "Klienti",
  "Klientské změny",
  "Obchodní případy",
  "Smlouvy",
  "Dokumenty",
  "Ceny",
  "Obchodní výjimky",
  "Platby",
  "Předání",
  "Reklamace",
  "Úkoly",
  "Uživatelé a role",
  "Systém",
  "Exporty a audit",
] as const;

export const permissionOperationOrder: PermissionOperation[] = [
  "view",
  "create",
  "update",
  "manage",
  "review",
  "approve",
  "record",
  "import",
  "export",
  "archive",
  "assign",
];

const unknownPermission: Omit<PermissionDefinition, "key"> = {
  name: "Další systémové oprávnění",
  description: "Toto oprávnění zatím nemá uživatelsky dostupný popis. Obraťte se na správce systému.",
  category: "Systém",
  operation: "manage",
  supportedScopes: ["workspace"],
  systemRestriction: "Neznámé oprávnění nelze bezpečně interpretovat v uživatelském rozhraní.",
};

export function getPermissionDefinition(key: string): PermissionDefinition {
  const definition = permissionCatalog[key];
  if (definition) return definition;
  if (typeof console !== "undefined") console.warn(`[DeveloCRM] Chybí český katalog oprávnění pro klíč: ${key}`);
  return {...unknownPermission, key};
}

export function permissionScopeLabel(scope: string): string {
  return ({
    workspace: "Celý pracovní prostor",
    project: "Přiřazené projekty",
    own: "Vlastní záznamy",
    agency: "Klienti realitní kanceláře",
    partner: "Klienti realitní kanceláře",
  } as Record<string, string>)[scope] ?? "Přiřazené projekty";
}

export function sortPermissionDefinitions(a: PermissionDefinition, b: PermissionDefinition): number {
  const category = permissionCategoryOrder.indexOf(a.category as (typeof permissionCategoryOrder)[number])
    - permissionCategoryOrder.indexOf(b.category as (typeof permissionCategoryOrder)[number]);
  if (category) return category;
  const operation = permissionOperationOrder.indexOf(a.operation) - permissionOperationOrder.indexOf(b.operation);
  return operation || a.name.localeCompare(b.name, "cs");
}
