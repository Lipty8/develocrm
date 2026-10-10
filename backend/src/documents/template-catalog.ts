export type TemplateFieldDefinition={required:boolean;label:string;sample:string};
export type TemplateCatalog={
  outputTypeCode:string;
  contractType:"rs"|"sbk"|"ks"|null;
  label:string;
  fields:Record<string,TemplateFieldDefinition>;
};

export const TECHNICAL_PLACEHOLDERS=["project.name","project.code","unit.code","buyer.name","generation.date","unit.totalPrice"] as const;
export const RS_PLACEHOLDERS=["seller.name","seller.address","seller.registryEntry","seller.registrationNumber","seller.representative","seller.email","seller.dataBox","seller.bankAccount","buyer.salutation","buyer.name","buyer.address","buyer.birthDate","buyer.email","buyer.phone","buyer.dataBoxLine","project.name","project.completionYear","contract.reservationPeriodDays","unit.subjectClause","unit.balconyClause","unit.gardenClause","unit.outdoorParkingClause","unit.cellarClause","unit.garageClause","payment.reservationFeeClause","contract.totalPriceClause","contract.date"] as const;

const rsSamples:Record<(typeof RS_PLACEHOLDERS)[number],string>={
  "seller.name":"Rezidence Test s.r.o.","seller.address":"Testovací 1, 110 00 Praha 1","seller.registryEntry":"Městský soud v Praze, oddíl C, vložka 123456",
  "seller.registrationNumber":"12345678","seller.representative":"Jan Testovací, jednatel","seller.email":"smlouvy@example.test","seller.dataBox":"abc1234",
  "seller.bankAccount":"123456789/0100","buyer.salutation":"pan","buyer.name":"Petr Testovací","buyer.address":"Bezpečná 10, 160 00 Praha 6",
  "buyer.birthDate":"1. 1. 1990","buyer.email":"petr@example.test","buyer.phone":"+420 700 000 000","buyer.dataBoxLine":"Datová schránka: xyz9876",
  "project.name":"Technický test projektu","project.completionYear":"2028","contract.reservationPeriodDays":"30",
  "unit.subjectClause":"Bytová jednotka T-101 o dispozici 2+kk a ploše 55 m².","unit.balconyClause":"Součástí je balkon o ploše 5 m².",
  "unit.gardenClause":"Bez zahrady.","unit.outdoorParkingClause":"Venkovní parkovací stání P-T1.","unit.cellarClause":"Sklep S-T1.",
  "unit.garageClause":"Bez garážového stání.","payment.reservationFeeClause":"Rezervační poplatek činí 100 000 Kč.",
  "contract.totalPriceClause":"Celková cena činí 9 500 000 Kč.","contract.date":"10. 10. 2026",
};

const technicalSamples:Record<(typeof TECHNICAL_PLACEHOLDERS)[number],string>={
  "project.name":"Technický test projektu","project.code":"TEST","unit.code":"T-101","buyer.name":"Petr Testovací",
  "generation.date":"10. 10. 2026","unit.totalPrice":"9 500 000 Kč",
};

export const TEMPLATE_CATALOGS:Record<string,TemplateCatalog>={
  reservation_contract:{outputTypeCode:"reservation_contract",contractType:"rs",label:"Rezervační smlouva",fields:Object.fromEntries(RS_PLACEHOLDERS.map(token=>[token,{required:true,label:token,sample:rsSamples[token]}]))},
  other:{outputTypeCode:"other",contractType:null,label:"Technická DOCX šablona",fields:Object.fromEntries(TECHNICAL_PLACEHOLDERS.map(token=>[token,{required:true,label:token,sample:technicalSamples[token]}]))},
};

export function templateCatalog(outputTypeCode:string):TemplateCatalog|null{return TEMPLATE_CATALOGS[outputTypeCode]??null;}
export function supportedTemplateTokens():Set<string>{return new Set(Object.values(TEMPLATE_CATALOGS).flatMap(catalog=>Object.keys(catalog.fields)));}
