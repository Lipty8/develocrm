export type TemplateFieldDefinition={required:boolean;label:string;sample:string};
export type TemplateCatalog={
  outputTypeCode:string;
  contractType:"rs"|"sbk"|"ks"|null;
  label:string;
  fields:Record<string,TemplateFieldDefinition>;
  /** False for review profiles until their server-side business mapping is ready. */
  generationSupported?:boolean;
};

export const ORIGINAL_DOB_FULL_VARIANT='dejvice-original-dob-full-v1';

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

// Explicit scalar fields preserve the source's legal paragraphs. These profiles
// are separate from the older paragraph-based RS schema; never union requirements.
const originalCommon:Record<string,[string,string]>={
  'seller.name':['Prodávající','Testovací společnost s.r.o.'],
  'seller.address':['Sídlo prodávajícího','Testovací 1, 110 00 Praha 1'],
  'seller.registryEntry':['Zápis v rejstříku','Městský soud v Praze, oddíl C, vložka TEST'],
  'seller.registrationNumber':['IČO prodávajícího','00000000'],
  'seller.representative':['Zástupce prodávajícího','jednatelem, Janem Testovacím'],
  'seller.email':['E-mail prodávajícího','prodavajici@example.test'],
  'seller.dataBox':['Datová schránka prodávajícího','TEST'],
  'seller.bankAccount':['Účet prodávajícího','TESTOVACÍ ÚČET'],
  'seller.bankName':['Banka prodávajícího','TESTOVACÍ BANKA'],
  'seller.signatureName':['Jméno u podpisu prodávajícího','Jan Testovací, jednatel'],
  'buyer.salutation':['Oslovení','Pan'],
  'buyer.name':['Kupující','TESTOVACÍ KUPUJÍCÍ NEPODEPISOVAT'],
  'buyer.address':['Bydliště kupujícího','Testovací 62, 160 00 Praha 6'],
  'buyer.birthDate':['Datum narození','1. 1. 1990'],
  'buyer.email':['E-mail kupujícího','kupujici@example.test'],
  'buyer.phone':['Telefon kupujícího','+420 777 000 062'],
  'unit.code':['Jednotka','T-062'],
  'unit.floorNumber':['Nadzemní podlaží','3.'],
  'unit.outdoorSpaceCase':['Balkon nebo terasa','balkonu'],
  'unit.outdoorParkingCode':['Venkovní parkovací místo','P-TEST1'],
  'unit.cellarCode':['Sklep','S-TEST1'],
  'unit.cellarFloor':['Podlaží sklepa','1.PP'],
  'unit.garageCode':['Garážové místo','P-TEST2'],
  'unit.garageFloor':['Podlaží garáže','1.PP'],
  'unit.variableSymbol':['Variabilní symbol','62001'],
  'contract.totalPriceAmount':['Kupní cena','5 000 000'],
  'contract.totalPriceWords':['Kupní cena slovy','pět milionů'],
  'contract.sellerPlannedDate':['Plánované datum podpisu prodávajícího','17. 10. 2026'],
  'contract.buyerPlannedDate':['Plánované datum podpisu kupujícího','17. 10. 2026'],
};
function scalarFields(values:Record<string,[string,string]>):Record<string,TemplateFieldDefinition>{
  return Object.fromEntries(Object.entries(values).map(([token,[label,sample]])=>[token,{label,sample,required:true}]));
}
export const ORIGINAL_TEMPLATE_CATALOGS:Record<string,TemplateCatalog>={
  reservation_contract:{outputTypeCode:'reservation_contract',contractType:'rs',label:'RS Dejvice · kompletní varianta · datum narození',generationSupported:false,
    fields:scalarFields({...originalCommon,
      'buyer.dataBox':['Datová schránka kupujícího','neuvedena'],
      'payment.reservationFeeAmount':['Rezervační poplatek','250 000'],
      'payment.reservationFeeWords':['Rezervační poplatek slovy','dvě stě padesát tisíc'],
    })},
  future_purchase_contract:{outputTypeCode:'future_purchase_contract',contractType:'sbk',label:'SBK Dejvice · kompletní varianta · datum narození',generationSupported:false,
    fields:scalarFields({...originalCommon,
      'buyer.deliveryAddress':['Doručovací adresa kupujícího','Doručovací 62, 160 00 Praha 6'],
      'seller.clientChangesBankAccount':['Účet klientských změn','TESTOVACÍ ÚČET KLIENTSKÝCH ZMĚN'],
      'unit.area':['Podlahová plocha','55,5'],
      'unit.outdoorSpaceCase':['Balkon nebo terasa','Balkonu'],
      'unit.outdoorSpaceArea':['Plocha balkonu nebo terasy','5'],
      'unit.gardenArea':['Plocha předzahrádky','12'],
      'payment.reservationFeePaidAmount':['Zaplacený rezervační poplatek','250 000'],
      'payment.firstInstallmentAmount':['První splátka podle SBK','1 000 000'],
      'payment.finalInstallmentAmount':['Doplatek podle SBK','3 750 000'],
    })},
};

export function templateCatalog(outputTypeCode:string,variantKey='default'):TemplateCatalog|null{
  if(variantKey===ORIGINAL_DOB_FULL_VARIANT)return Object.hasOwn(ORIGINAL_TEMPLATE_CATALOGS,outputTypeCode)?ORIGINAL_TEMPLATE_CATALOGS[outputTypeCode]:null;
  return Object.hasOwn(TEMPLATE_CATALOGS,outputTypeCode)?TEMPLATE_CATALOGS[outputTypeCode]:null;
}
export function supportedTemplateTokens():Set<string>{return new Set([...Object.values(TEMPLATE_CATALOGS),...Object.values(ORIGINAL_TEMPLATE_CATALOGS)].flatMap(catalog=>Object.keys(catalog.fields)));}
