export type UnitStatus = "Volný" | "Předrezervace" | "RS" | "SBK" | "KS" | "Předáno" | "Blokováno";

export type UnitRecord = {
  id: string;
  project: string;
  building: string;
  layout: string;
  area: number;
  floor: string;
  orientation: string;
  price: number;
  status: UnitStatus;
  construction: string;
  handover: string;
  client?: string;
  attention?: string;
  accessory: string;
};

export const units: UnitRecord[] = [
  { id: "A203", project: "Rezidence Javorová", building: "Dům A", layout: "3+kk", area: 82.4, floor: "2. NP", orientation: "J / Z", price: 8990000, status: "SBK", construction: "Dokončovací práce", handover: "Připravenost 72 %", client: "Jana a Petr Novákovi", attention: "Doplnit číslo účtu klienta", accessory: "Sklep S18 · Parking P32 · Wallbox" },
  { id: "A101", project: "Rezidence Javorová", building: "Dům A", layout: "2+kk", area: 54.8, floor: "1. NP", orientation: "J", price: 6490000, status: "Volný", construction: "Dokončovací práce", handover: "Neplánováno", accessory: "Sklep S04" },
  { id: "A305", project: "Rezidence Javorová", building: "Dům A", layout: "4+kk", area: 105.2, floor: "3. NP", orientation: "J / V", price: 12490000, status: "RS", construction: "Dokončovací práce", handover: "Neplánováno", client: "David Kříž", attention: "RS čeká na podpis 3 dny", accessory: "Sklep S27 · Parking P41" },
  { id: "B104", project: "Rezidence Javorová", building: "Dům B", layout: "2+kk", area: 58.1, floor: "1. NP", orientation: "Z", price: 6990000, status: "Předrezervace", construction: "Hrubá stavba", handover: "Neplánováno", client: "Lucie Malá", attention: "Předrezervace končí zítra", accessory: "Sklep S31 · Parking P52" },
  { id: "B207", project: "Rezidence Javorová", building: "Dům B", layout: "3+kk", area: 76.9, floor: "2. NP", orientation: "J / Z", price: 8490000, status: "Volný", construction: "Hrubá stavba", handover: "Neplánováno", accessory: "Sklep S39" },
  { id: "B308", project: "Rezidence Javorová", building: "Dům B", layout: "3+kk", area: 88.3, floor: "3. NP", orientation: "V / J", price: 9690000, status: "KS", construction: "Hrubá stavba", handover: "Q4 2026", client: "Alto Services s.r.o.", accessory: "Sklep S46 · Parking P61" },
  { id: "C102", project: "Parková čtvrť", building: "Etapa I", layout: "1+kk", area: 38.6, floor: "1. NP", orientation: "V", price: 4790000, status: "KS", construction: "Dokončeno", handover: "26. 7. 2026", client: "Marek Veselý", attention: "Chybí revize wallboxu", accessory: "Parking P08 · Wallbox" },
  { id: "C211", project: "Parková čtvrť", building: "Etapa I", layout: "3+kk", area: 79.4, floor: "2. NP", orientation: "J", price: 8790000, status: "Předáno", construction: "Dokončeno", handover: "Předáno 8. 7.", client: "Kateřina Dvořáková", accessory: "Sklep S14 · Parking P16" },
  { id: "D404", project: "Parková čtvrť", building: "Etapa II", layout: "4+kk", area: 112.7, floor: "4. NP", orientation: "J / Z", price: 13990000, status: "SBK", construction: "Ve výstavbě", handover: "Q2 2027", client: "Tomáš Janda", attention: "2. splátka po splatnosti", accessory: "Sklep S52 · Parking P74 · Parking P75" },
  { id: "E106", project: "Vily Stráň", building: "Vila E", layout: "5+kk", area: 168.2, floor: "2 podlaží", orientation: "J / V / Z", price: 21900000, status: "Volný", construction: "Příprava", handover: "Q4 2027", accessory: "Garáž G06 · Sklad 9,8 m²" },
];

export const projects = [
  { name: "Rezidence Javorová", code: "RJ", location: "Praha 5 · Jinonice", progress: 82, units: 68, available: 9, preReserved: 4, reserved: 8, sold: 39, handedOver: 8, attention: 6, color: "sage", stage: "Dokončovací práce", revenue: "482,6 mil. Kč", buildings: ["Dům A", "Dům B"], manager: "Martin Jelínek", plannedHandover: "Q4 2026" },
  { name: "Parková čtvrť", code: "PČ", location: "Brno · Černá Pole", progress: 61, units: 94, available: 19, preReserved: 6, reserved: 12, sold: 42, handedOver: 15, attention: 9, color: "sand", stage: "Etapa I dokončena", revenue: "536,2 mil. Kč", buildings: ["Etapa I", "Etapa II"], manager: "Pavel Sedlák", plannedHandover: "Q2 2027" },
  { name: "Vily Stráň", code: "VS", location: "Praha-východ · Průhonice", progress: 18, units: 12, available: 8, preReserved: 1, reserved: 1, sold: 2, handedOver: 0, attention: 2, color: "slate", stage: "Příprava", revenue: "65,7 mil. Kč", buildings: ["Vila E", "Vila F", "Vila G"], manager: "Klára Bendová", plannedHandover: "Q4 2027" },
];

export const tasks = [
  { id: 1, title: "Doplnit číslo účtu klienta", object: "A203 · Jana a Petr Novákovi", project: "Rezidence Javorová", due: "Dnes", priority: "Vysoká", owner: "Iva", done: false },
  { id: 2, title: "Zkontrolovat revizi wallboxu", object: "C102 · Předání", project: "Parková čtvrť", due: "Dnes", priority: "Vysoká", owner: "Martin", done: false },
  { id: 3, title: "Připravit KS k připomínkám", object: "B308 · Alto Services s.r.o.", project: "Rezidence Javorová", due: "Zítra", priority: "Střední", owner: "Iva", done: false },
  { id: 4, title: "Potvrdit termín předání", object: "C102 · Marek Veselý", project: "Parková čtvrť", due: "23. 7.", priority: "Střední", owner: "Martin", done: false },
  { id: 5, title: "Přiřadit dokument ze SharePointu", object: "D404 · dodatek č. 2", project: "Parková čtvrť", due: "24. 7.", priority: "Nízká", owner: "Iva", done: false },
];

export const contracts = [
  { unit: "A203", client: "Jana a Petr Novákovi", project: "Rezidence Javorová", type: "SBK", state: "Ve vyjednávání", updated: "dnes 9:42", owner: "Iva", action: "Zapracovat připomínky" },
  { unit: "A305", client: "David Kříž", project: "Rezidence Javorová", type: "RS", state: "Odeslána", updated: "včera 15:18", owner: "Iva", action: "Urgovat podpis" },
  { unit: "B308", client: "Alto Services s.r.o.", project: "Rezidence Javorová", type: "KS", state: "V přípravě", updated: "včera 11:05", owner: "Iva", action: "Doplnit přílohy" },
  { unit: "D404", client: "Tomáš Janda", project: "Parková čtvrť", type: "Dodatek č. 2", state: "Ke kontrole", updated: "18. 7. 14:30", owner: "Pavel", action: "Právní kontrola" },
  { unit: "C102", client: "Marek Veselý", project: "Parková čtvrť", type: "KS", state: "Podepsána", updated: "14. 7. 10:22", owner: "Iva", action: "Bez akce" },
];

export const payments = [
  { unit: "D404", client: "Tomáš Janda", project: "Parková čtvrť", installment: "2. splátka · 20 %", amount: 2798000, due: "16. 7. 2026", paid: 1800000, state: "Po splatnosti" },
  { unit: "A203", client: "Jana a Petr Novákovi", project: "Rezidence Javorová", installment: "3. splátka · 30 %", amount: 2697000, due: "31. 7. 2026", paid: 0, state: "Čeká na úhradu" },
  { unit: "B308", client: "Alto Services s.r.o.", project: "Rezidence Javorová", installment: "2. splátka · 40 %", amount: 3876000, due: "5. 8. 2026", paid: 0, state: "Čeká na úhradu" },
  { unit: "C102", client: "Marek Veselý", project: "Parková čtvrť", installment: "Doplatek · 10 %", amount: 479000, due: "10. 7. 2026", paid: 479000, state: "Uhrazeno" },
];

export const clients = [
  { id: "c1", name: "Jana a Petr Novákovi", type: "2 fyzické osoby", kind: "FO", email: "jana.novakova@email.cz", phone: "+420 602 145 778", contact: "jana.novakova@email.cz · +420 602 145 778", units: ["A203"], projects: "Rezidence Javorová", projectNames: ["Rezidence Javorová"], state: "Aktivní klient", contractStatus: "Podepsaná KS", initials: "JN" },
  { id: "c2", name: "Alto Services s.r.o.", type: "Právnická osoba", kind: "PO", email: "office@altoservices.cz", phone: "+420 222 784 110", contact: "office@altoservices.cz · +420 222 784 110", units: ["B308", "E106"], projects: "Rezidence Javorová, Vily Stráň", projectNames: ["Rezidence Javorová", "Vily Stráň"], state: "Aktivní klient", contractStatus: "Podepsaná KS", initials: "AS" },
  { id: "c3", name: "Tomáš Janda", type: "Fyzická osoba", kind: "FO", email: "tomas.janda@email.cz", phone: "+420 723 441 029", contact: "tomas.janda@email.cz · +420 723 441 029", units: ["D404"], projects: "Parková čtvrť", projectNames: ["Parková čtvrť"], state: "Aktivní klient", contractStatus: "Podepsaná SBK", initials: "TJ" },
  { id: "c4", name: "Marek Veselý", type: "Fyzická osoba", kind: "FO", email: "m.vesely@email.cz", phone: "+420 777 842 105", contact: "m.vesely@email.cz · +420 777 842 105", units: ["C102"], projects: "Parková čtvrť", projectNames: ["Parková čtvrť"], state: "Předání", contractStatus: "Podepsaná KS", initials: "MV" },
  { id: "c5", name: "Lucie Malá", type: "Fyzická osoba", kind: "FO", email: "lucie.mala@email.cz", phone: "+420 608 905 314", contact: "lucie.mala@email.cz · +420 608 905 314", units: ["B104", "C211"], projects: "Rezidence Javorová, Parková čtvrť", projectNames: ["Rezidence Javorová", "Parková čtvrť"], state: "Zájemce", contractStatus: "Bez smlouvy", initials: "LM" },
  { id: "c6", name: "David Kříž", type: "Fyzická osoba", kind: "FO", email: "david.kriz@email.cz", phone: "+420 731 225 980", contact: "david.kriz@email.cz · +420 731 225 980", units: ["A305"], projects: "Rezidence Javorová", projectNames: ["Rezidence Javorová"], state: "Aktivní klient", contractStatus: "RS k podpisu", initials: "DK" },
  { id: "c7", name: "Kateřina Dvořáková", type: "Fyzická osoba", kind: "FO", email: "katerina.dvorakova@email.cz", phone: "+420 606 411 728", contact: "katerina.dvorakova@email.cz · +420 606 411 728", units: ["C211"], projects: "Parková čtvrť", projectNames: ["Parková čtvrť"], state: "Předáno", contractStatus: "Podepsaná KS", initials: "KD" },
  { id: "c8", name: "NORD Invest a.s.", type: "Právnická osoba", kind: "PO", email: "reality@nordinvest.cz", phone: "+420 221 903 440", contact: "reality@nordinvest.cz · +420 221 903 440", units: ["A101", "B207"], projects: "Rezidence Javorová", projectNames: ["Rezidence Javorová"], state: "Zájemce", contractStatus: "Bez smlouvy", initials: "NI" },
  { id: "c9", name: "Eva Benešová", type: "Fyzická osoba", kind: "FO", email: "eva.benesova@email.cz", phone: "+420 725 819 302", contact: "eva.benesova@email.cz · +420 725 819 302", units: ["E106"], projects: "Vily Stráň", projectNames: ["Vily Stráň"], state: "Zájemce", contractStatus: "Předrezervace", initials: "EB" },
  { id: "c10", name: "Rodinné bydlení s.r.o.", type: "Právnická osoba", kind: "PO", email: "info@rodinnebydleni.cz", phone: "+420 224 618 901", contact: "info@rodinnebydleni.cz · +420 224 618 901", units: ["D404", "E106"], projects: "Parková čtvrť, Vily Stráň", projectNames: ["Parková čtvrť", "Vily Stráň"], state: "Zájemce", contractStatus: "Bez smlouvy", initials: "RB" },
];

export const activity = [
  { time: "10:24", title: "Přidána připomínka ke smlouvě SBK", meta: "A203 · Iva Novotná", kind: "contract" },
  { time: "9:42", title: "Nahrána nová verze SBK_v04.docx", meta: "A203 · SharePoint", kind: "document" },
  { time: "9:15", title: "Spárována částečná úhrada 1 800 000 Kč", meta: "D404 · Martin Jelínek", kind: "payment" },
  { time: "Včera", title: "Potvrzen termín předání 26. 7. v 10:00", meta: "C102 · Martin Jelínek", kind: "handover" },
  { time: "Včera", title: "Cena jednotky změněna na 8 490 000 Kč", meta: "B207 · Pavel Sedlák", kind: "price" },
];

export const unitTimeline = [
  { date: "Dnes · 10:24", title: "Přidána připomínka ke smlouvě SBK", detail: "Iva Novotná · Klient požaduje doplnit termín zápisu do KN.", icon: "contract" },
  { date: "Dnes · 9:42", title: "Nahrána verze SBK_v04.docx", detail: "Synchronizováno se SharePointem · změnil Pavel Sedlák", icon: "document" },
  { date: "18. 7. · 16:08", title: "Stavební stav změněn", detail: "Instalace dokončeny → Dokončovací práce · Martin Jelínek", icon: "build" },
  { date: "15. 7. · 11:30", title: "Přijata 2. splátka", detail: "2 247 500 Kč · bankovní párování", icon: "payment" },
  { date: "4. 7. · 14:12", title: "SBK odeslána klientům", detail: "Odesláno Janě a Petru Novákovým · Iva Novotná", icon: "contract" },
  { date: "1. 7. · 9:00", title: "Cena jednotky upravena", detail: "8 790 000 Kč → 8 990 000 Kč · Pavel Sedlák", icon: "price" },
];

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(value);
