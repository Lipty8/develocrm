import type {PoolClient} from "pg";
import type {Database} from "../database.js";

export type InventoryEntityType="unit"|"cellar"|"parking";
export type InventoryImportRow={
  rowNumber:number;code?:string;layout?:string;areaM2?:number|null;usableAreaM2?:number|null;
  floorLabel?:string;orientation?:string;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null;
  price?:number|null;commercialStatus?:string;constructionStatus?:string;type?:string;unitCode?:string;
  wallboxCode?:string;wallboxPrice?:number|null;
};
export type InventoryPreviewRow=InventoryImportRow&{action:"create"|"update"|"skip"|"error";errors:string[]};
export type InventoryImportPreview={rows:InventoryPreviewRow[];summary:{source:number;created:number;updated:number;skipped:number;errors:number;duplicates:number;unknownUnits:number;missingFields:number}};

type Context={tenantId:string;userId:string;membershipId:string};

export class InventoryImportService{
  constructor(private readonly database:Database){}

  preview(input:Context&{projectId:string;entityType:InventoryEntityType;rows:InventoryImportRow[];strategy?:"update"|"skip"}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},client=>this.validate(client,input));
  }

  confirm(input:Context&{projectId:string;entityType:InventoryEntityType;rows:InventoryImportRow[];strategy:"update"|"skip";idempotencyKey:string;fileName?:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const previous=await client.query<{id:string;result:InventoryImportPreview}>("SELECT id,result FROM project_inventory_import_batches WHERE tenant_id=$1 AND project_id=$2 AND idempotency_key=$3",[input.tenantId,input.projectId,input.idempotencyKey]);
      if(previous.rows[0])return{batchId:previous.rows[0].id,preview:previous.rows[0].result,replayed:true};
      const preview=await this.validate(client,input);
      if(preview.summary.errors)throw new Error("Import obsahuje chyby. Opravte je před potvrzením.");
      let created=0,updated=0,skipped=0;
      for(const row of preview.rows){
        if(row.action==="skip"){skipped++;continue;}
        if(input.entityType==="unit"){
          const outcome=await this.upsertUnit(client,input,row);created+=outcome==="create"?1:0;updated+=outcome==="update"?1:0;
        }else{
          const outcome=await this.upsertAccessory(client,input,row);created+=outcome==="create"?1:0;updated+=outcome==="update"?1:0;
        }
      }
      const result={...preview,summary:{...preview.summary,created,updated,skipped}};
      const batch=await client.query<{id:string}>(`INSERT INTO project_inventory_import_batches(
        tenant_id,project_id,entity_type,idempotency_key,file_name,strategy,source_rows,created_count,updated_count,skipped_count,result,imported_by_membership_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[
        input.tenantId,input.projectId,input.entityType,input.idempotencyKey,input.fileName??null,input.strategy,input.rows.length,created,updated,skipped,JSON.stringify(result),input.membershipId,
      ]);
      await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES($1,$2,'project.inventory_imported','project_import',$3,$4,$5)",[input.tenantId,input.userId,batch.rows[0].id,JSON.stringify({entityType:input.entityType,created,updated,skipped}),JSON.stringify({projectId:input.projectId})]);
      await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'project',$2,'project.inventory_imported.v1',$3)",[input.tenantId,input.projectId,JSON.stringify({batchId:batch.rows[0].id,projectId:input.projectId,entityType:input.entityType,created,updated,skipped})]);
      return{batchId:batch.rows[0].id,preview:result,replayed:false};
    });
  }

  async createUnit(input:Context&{projectId:string;row:InventoryImportRow}){
    const result=await this.confirm({...input,entityType:"unit",rows:[input.row],strategy:"update",idempotencyKey:`manual-unit-${crypto.randomUUID()}`,fileName:"Ruční založení"});
    return result;
  }

  private async validate(client:PoolClient,input:Context&{projectId:string;entityType:InventoryEntityType;rows:InventoryImportRow[];strategy?:"update"|"skip"}):Promise<InventoryImportPreview>{
    const permission=input.entityType==="unit"?"unit.manage":"accessory.manage";
    const allowed=await client.query<{allowed:boolean}>("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL) AND app.has_project_permission($1,$3,$2,$4) allowed",[input.tenantId,input.projectId,input.membershipId,permission]);
    if(!allowed.rows[0]?.allowed)throw new Error("Nemáte oprávnění importovat data do tohoto projektu.");
    const existing=await client.query<{id:string;code:string;commercial_status?:string;assignment_unit_code?:string|null}>(input.entityType==="unit"
      ?"SELECT id,code,commercial_status FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL"
      :`SELECT accessory.id,accessory.code,assigned.unit_code assignment_unit_code FROM accessories accessory
         JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
         LEFT JOIN LATERAL(SELECT unit.code unit_code FROM unit_accessory_assignments assignment JOIN units unit ON unit.tenant_id=assignment.tenant_id AND unit.id=assignment.unit_id WHERE assignment.tenant_id=accessory.tenant_id AND assignment.accessory_id=accessory.id AND assignment.valid_from<=now() AND (assignment.valid_to IS NULL OR assignment.valid_to>now()) LIMIT 1) assigned ON true
         WHERE accessory.tenant_id=$1 AND accessory.project_id=$2 AND accessory.archived_at IS NULL AND type.category=$3`,
      input.entityType==="unit"?[input.tenantId,input.projectId]:[input.tenantId,input.projectId,input.entityType]);
    const existingByCode=new Map(existing.rows.map(row=>[row.code.trim().toLocaleLowerCase("cs-CZ"),row]));
    const projectUnits=await client.query<{code:string}>("SELECT code FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL",[input.tenantId,input.projectId]);
    const unitCodes=new Set(projectUnits.rows.map(row=>row.code.trim().toLocaleLowerCase("cs-CZ")));
    const occurrences=new Map<string,number>();for(const row of input.rows){const code=clean(row.code).toLocaleLowerCase("cs-CZ");if(code)occurrences.set(code,(occurrences.get(code)??0)+1);}
    let duplicates=0,unknownUnits=0;
    const rows=input.rows.map(row=>{
      const errors:string[]=[];const code=clean(row.code);const key=code.toLocaleLowerCase("cs-CZ");
      if(!code)errors.push("Chybí označení");if(code.length>40)errors.push("Označení je delší než 40 znaků");
      if((occurrences.get(key)??0)>1){errors.push("Duplicitní označení v souboru");duplicates++;}
      if(input.entityType==="unit"){
        if(!positive(row.areaM2))errors.push("Plocha musí být větší než 0");
        if(row.price!=null&&!nonNegative(row.price))errors.push("Cena nesmí být záporná");
        const status=normalCommercial(row.commercialStatus);if(row.commercialStatus&&!status)errors.push("Neznámý obchodní stav");
        const construction=normalConstruction(row.constructionStatus);if(row.constructionStatus&&!construction)errors.push("Neznámý stavební stav");
        const found=existingByCode.get(key);if(found&&status&&found.commercial_status!==status)errors.push("Obchodní stav existující jednotky nelze měnit importem");
      }else{
        if(input.entityType==="cellar"&&!positive(row.areaM2))errors.push("Výměra sklepa musí být větší než 0");
        if(row.price==null||!nonNegative(row.price))errors.push("Cena musí být vyplněná a nesmí být záporná");
        const unitCode=clean(row.unitCode).toLocaleLowerCase("cs-CZ");
        if(unitCode&&!unitCodes.has(unitCode)){errors.push("Přiřazená jednotka v tomto projektu neexistuje");unknownUnits++;}
        const found=existingByCode.get(key);if(found?.assignment_unit_code&&unitCode&&found.assignment_unit_code.toLocaleLowerCase("cs-CZ")!==unitCode)errors.push("Položka je právě přiřazená jiné jednotce");
      }
      const found=existingByCode.has(key);const action:InventoryPreviewRow["action"]=errors.length?"error":found?(input.strategy==="skip"?"skip":"update"):"create";
      return{...row,code,commercialStatus:normalCommercial(row.commercialStatus)??undefined,constructionStatus:normalConstruction(row.constructionStatus)??undefined,action,errors};
    });
    return{rows,summary:{source:rows.length,created:rows.filter(row=>row.action==="create").length,updated:rows.filter(row=>row.action==="update").length,skipped:rows.filter(row=>row.action==="skip").length,errors:rows.filter(row=>row.action==="error").length,duplicates,unknownUnits,missingFields:rows.filter(row=>row.errors.some(error=>error.startsWith("Chybí")||error.includes("musí být vyplněná")||error.startsWith("Výměra sklepa"))).length}};
  }

  private async upsertUnit(client:PoolClient,input:Context&{projectId:string},row:InventoryPreviewRow):Promise<"create"|"update"> {
    const found=await client.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND lower(code)=lower($3) AND archived_at IS NULL FOR UPDATE",[input.tenantId,input.projectId,row.code]);
    const status=normalCommercial(row.commercialStatus)??"available";const construction=normalConstruction(row.constructionStatus);
    let unitId=found.rows[0]?.id;
    if(!unitId){
      const inserted=await client.query<{id:string}>(`INSERT INTO units(tenant_id,project_id,code,layout,floor_label,floor_number,area_m2,usable_area_m2,orientation,balcony_m2,terrace_m2,garden_m2,commercial_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[input.tenantId,input.projectId,row.code,clean(row.layout)||null,clean(row.floorLabel)||null,floorNumber(row.floorLabel),row.areaM2,row.usableAreaM2??null,clean(row.orientation)||null,row.balconyM2??null,row.terraceM2??null,row.gardenM2??null,status]);
      unitId=inserted.rows[0].id;
      await client.query("INSERT INTO unit_commercial_status_events(tenant_id,project_id,unit_id,from_status,to_status,command,reason,recorded_by_membership_id) VALUES($1,$2,$3,NULL,$4,'seed','Založení jednotky importem',$5)",[input.tenantId,input.projectId,unitId,status,input.membershipId]);
      await this.recordUnitSideEffects(client,input,unitId,row,construction,"unit.created");
      return"create";
    }
    await client.query("SELECT app.update_unit_details_v2($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[input.tenantId,unitId,clean(row.layout)||null,clean(row.floorLabel)||null,floorNumber(row.floorLabel),row.areaM2,row.usableAreaM2??null,clean(row.orientation)||null,row.balconyM2??null,row.terraceM2??null,row.gardenM2??null,input.membershipId]);
    await this.recordUnitSideEffects(client,input,unitId,row,construction,"unit.import_updated");
    return"update";
  }

  private async recordUnitSideEffects(client:PoolClient,input:Context&{projectId:string},unitId:string,row:InventoryPreviewRow,construction:string|null,action:string){
    if(row.price!=null){const current=await client.query<{amount:number|null}>("SELECT app.current_unit_price($1,$2,now())::float8 amount",[input.tenantId,unitId]);if(Number(current.rows[0]?.amount??-1)!==Number(row.price))await client.query("INSERT INTO unit_price_history(tenant_id,project_id,unit_id,price_type,amount,currency,valid_from,reason,recorded_by_membership_id,approved_by_membership_id,approved_at) VALUES($1,$2,$3,'sales',$4,'CZK',clock_timestamp(),'Projektový import',$5,$5,now())",[input.tenantId,input.projectId,unitId,row.price,input.membershipId]);}
    if(construction)await client.query("INSERT INTO unit_completion_status_events(tenant_id,project_id,unit_id,event_type,status_code,effective_at,reason,recorded_by_membership_id) VALUES($1,$2,$3,'set_override',$4,now(),'Individuální stav z projektového importu',$5)",[input.tenantId,input.projectId,unitId,construction,input.membershipId]);
    await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES($1,$2,$3,'unit',$4,$5,$6)",[input.tenantId,input.userId,action,unitId,JSON.stringify({code:row.code,price:row.price??null}),JSON.stringify({projectId:input.projectId,source:"project_import"})]);
    await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'unit',$2,$3,$4)",[input.tenantId,unitId,`${action}.v1`,JSON.stringify({unitId,projectId:input.projectId})]);
  }

  private async upsertAccessory(client:PoolClient,input:Context&{projectId:string;entityType:InventoryEntityType},row:InventoryPreviewRow):Promise<"create"|"update"> {
    const found=await client.query<{id:string}>("SELECT id FROM accessories WHERE tenant_id=$1 AND project_id=$2 AND lower(code)=lower($3) AND archived_at IS NULL FOR UPDATE",[input.tenantId,input.projectId,row.code]);
    let accessoryId=found.rows[0]?.id;let outcome:"create"|"update"="update";
    if(!accessoryId){const created=await client.query<{id:string}>("SELECT app.create_project_accessory($1,$2,$3,$4,$5,$6,NULL,NULL,$7) id",[input.tenantId,input.projectId,input.entityType,row.code,row.areaM2??null,row.price??0,input.membershipId]);accessoryId=created.rows[0].id;outcome="create";}
    else await client.query("SELECT app.update_project_accessory($1,$2,$3,$4,$5,NULL,'Projektový import',$6)",[input.tenantId,accessoryId,row.code,row.areaM2??null,row.price??0,input.membershipId]);
    if(row.floorLabel||row.type)await client.query("UPDATE accessories SET floor_label=COALESCE($3,floor_label),description=COALESCE($4,description),updated_at=now() WHERE tenant_id=$1 AND id=$2",[input.tenantId,accessoryId,clean(row.floorLabel)||null,input.entityType==="parking"?(clean(row.type)||null):null]);
    const unitCode=clean(row.unitCode);if(unitCode){const unit=await client.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND lower(code)=lower($3) AND archived_at IS NULL",[input.tenantId,input.projectId,unitCode]);const assigned=await client.query<{unit_id:string}>("SELECT unit_id FROM unit_accessory_assignments WHERE tenant_id=$1 AND accessory_id=$2 AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())",[input.tenantId,accessoryId]);if(!assigned.rows.length)await client.query("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4)",[input.tenantId,unit.rows[0].id,accessoryId,input.membershipId]);}
    if(input.entityType==="parking"&&clean(row.wallboxCode)){
      const requested=clean(row.wallboxCode);const wallboxCode=/^(ano|yes|true|1)$/i.test(requested)?`WB-${row.code}`:requested;
      const existingWallbox=await client.query<{id:string}>(`SELECT accessory.id FROM accessories accessory JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id WHERE accessory.tenant_id=$1 AND accessory.project_id=$2 AND lower(accessory.code)=lower($3) AND accessory.archived_at IS NULL AND type.category='wallbox' FOR UPDATE OF accessory`,[input.tenantId,input.projectId,wallboxCode]);
      let wallboxId=existingWallbox.rows[0]?.id;
      if(!wallboxId){const created=await client.query<{id:string}>("SELECT app.create_project_accessory($1,$2,'wallbox',$3,NULL,$4,NULL,$5,$6) id",[input.tenantId,input.projectId,wallboxCode,row.wallboxPrice??0,accessoryId,input.membershipId]);wallboxId=created.rows[0].id;}
      else if(!await relationExists(client,input.tenantId,wallboxId,accessoryId))await client.query("INSERT INTO accessory_relations(tenant_id,project_id,source_accessory_id,target_accessory_id,relation_type) VALUES($1,$2,$3,$4,'installed_at')",[input.tenantId,input.projectId,wallboxId,accessoryId]);
    }
    return outcome;
  }
}

function clean(value:unknown){return typeof value==="string"?value.trim():"";}
function positive(value:unknown){return typeof value==="number"&&Number.isFinite(value)&&value>0;}
function nonNegative(value:unknown){return typeof value==="number"&&Number.isFinite(value)&&value>=0;}
function floorNumber(value:unknown){const parsed=Number(String(value??"").replace(",",".").match(/-?\d+(?:\.\d+)?/)?.[0]);return Number.isFinite(parsed)?parsed:null;}
function normalCommercial(value:unknown){const key=clean(value).toLocaleLowerCase("cs-CZ").replace(/[ _-]+/g,"_");if(!key)return null;return({volný:"available",volna:"available",available:"available",předrezervovaná:"pre_reserved",předrezervace:"pre_reserved",pre_reserved:"pre_reserved",rezervovaná:"reserved",rezervace:"reserved",reserved:"reserved",sbk:"contracted",contracted:"contracted",prodaná:"sold",prodana:"sold",sold:"sold",předaná:"handed_over",predana:"handed_over",handed_over:"handed_over",blokovaná:"blocked",blocked:"blocked"} as Record<string,string>)[key]??null;}
function normalConstruction(value:unknown){const key=clean(value).toLocaleLowerCase("cs-CZ").replace(/[ _-]+/g,"_");if(!key)return null;return({příprava:"preparation",priprava:"preparation",preparation:"preparation",ve_výstavbě:"construction",ve_vystavbe:"construction",construction:"construction",hrubá_stavba:"rough_construction",rough_construction:"rough_construction",instalace:"installations",installations:"installations",dokončovací_práce:"fit_out",fit_out:"fit_out",dokončeno:"completed",completed:"completed"} as Record<string,string>)[key]??null;}
async function relationExists(client:PoolClient,tenantId:string,sourceId:string,targetId:string){return Boolean((await client.query("SELECT 1 FROM accessory_relations WHERE tenant_id=$1 AND source_accessory_id=$2 AND target_accessory_id=$3 AND relation_type='installed_at'",[tenantId,sourceId,targetId])).rows.length);}
