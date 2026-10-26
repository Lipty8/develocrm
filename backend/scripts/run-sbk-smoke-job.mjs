// One-execution override only: never changes the scheduled job or API revision.
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertSmokeInput,assertSyntheticTemplate,assertApprovedOriginalTemplate,assertTechnicalAppendix} from './smoke-sbk-business.mjs';

export function smokeJobDefinition({source,input,deployed}){
  assertSmokeInput(input);
  if(!deployed?.ready||deployed.ready!==deployed.latest||!/^acrdevelocrmpilot9a4c6e\.azurecr\.io\/develocrm-api@sha256:[a-f0-9]{64}$/.test(deployed.image??''))
    throw new Error('SMOKE_MATCHING_READY_IMMUTABLE_IMAGE_REQUIRED');
  const payload={...input};delete payload.databaseUrl;
  const env=[{name:'DATABASE_URL',secretRef:'database-url'},
    {name:'SMOKE_OPERATOR',value:source.replaceAll("from '../dist/","from 'file:///app/backend/dist/")}];
  if(['prepare_rs','prepare_sbk'].includes(input.mode)){
    for(const kind of ['rs','sbk']){
      const file=input.templates?.[kind];if(!file)throw new Error('SMOKE_TEMPLATE_INPUT_REQUIRED');
      const bytes=Buffer.from(file.base64,'base64');
      if(input.profile==='approved-original')assertApprovedOriginalTemplate(bytes,kind);
      else assertSyntheticTemplate(bytes,file.sha256,kind);
      env.push({name:`SMOKE_${kind.toUpperCase()}_SOURCE`,value:JSON.stringify(file)});
    }
    if(input.profile==='approved-original'){
      assertTechnicalAppendix(input.technicalAppendix);
      env.push({name:'SMOKE_APPENDIX_SOURCE',value:JSON.stringify(input.technicalAppendix)});
    }
  }
  delete payload.templates;delete payload.technicalAppendix;
  env.push({name:'SMOKE_INPUT',value:JSON.stringify(payload)});
  // Linux limits each argv/environment entry independently. Legal DOCX bytes
  // must not be embedded into one oversized node -e argument.
  if(env.some(e=>e.value&&Buffer.byteLength(e.name+'='+e.value)>110000))throw new Error('SMOKE_ENV_VALUE_TOO_LONG');
  const command=`const source=process.env.SMOKE_OPERATOR.replace("'fflate'",JSON.stringify(import.meta.resolve('fflate')));
const {runSbkSmoke}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const input=JSON.parse(process.env.SMOKE_INPUT);
if(process.env.SMOKE_RS_SOURCE){input.templates={rs:JSON.parse(process.env.SMOKE_RS_SOURCE),sbk:JSON.parse(process.env.SMOKE_SBK_SOURCE)};if(process.env.SMOKE_APPENDIX_SOURCE)input.technicalAppendix=JSON.parse(process.env.SMOKE_APPENDIX_SOURCE);}
const outcome=await runSbkSmoke({...input,databaseUrl:process.env.DATABASE_URL});if(!outcome.ok)process.exitCode=1;`;
  return{containers:[{name:'job-develocrm-hold-expiry',image:deployed.image,env,resources:{cpu:0.5,memory:'1Gi'},command:['node','--input-type=module','-e',command]}]};
}

async function main(){
  // Optional third argument is explicit; omitted preserves the TECH72 fixture.
  const [mode,projectId,profile]=process.argv.slice(2);
  const input={mode,projectId,profile,tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',membershipId:'40b59cc5-0007-436e-82dd-b30eef82e6eb',
    confirmSyntheticOnly:true,managedIdentityClientId:'134a9cd1-c2d7-4386-b47c-c59260ad460c'};
  assertSmokeInput(input);
  if(['prepare_rs','prepare_sbk'].includes(mode)){
    const manifest=JSON.parse(readFileSync(new URL('../templates/technical/manifest.json',import.meta.url),'utf8'));
    if(manifest.syntheticOnly!==true||manifest.legalContent!==false)throw new Error('SYNTHETIC_MANIFEST_REQUIRED');
    input.templates={};
    for(const kind of ['rs','sbk']){
      const path=profile==='approved-original'?`../templates/review/${kind==='rs'?'rs-dejvice-original-review.docx':'sbk-dejvice-original-delivery-review.docx'}`:`../templates/technical/TECH72-${kind}-synthetic-template.docx`;
      const bytes=readFileSync(new URL(path,import.meta.url));
      input.templates[kind]={base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
      if(!profile&&input.templates[kind].sha256!==manifest.files[kind].sha256)throw new Error('SMOKE_TEMPLATE_HASH_MISMATCH');
    }
    if(profile==='approved-original'){
      const bytes=readFileSync(new URL('../templates/technical/TECH72-rs-synthetic-template.docx',import.meta.url));
      input.technicalAppendix={base64:bytes.toString('base64'),sha256:manifest.files.rs.sha256};
    }
  }
  const source=readFileSync(new URL('./smoke-sbk-business.mjs',import.meta.url),'utf8');
  const live=spawnSync('/opt/homebrew/bin/az',['containerapp','show','--name','ca-develocrm-api-pilot','--resource-group','rg-develocrm-pilot',
    '--query','{ready:properties.latestReadyRevisionName,latest:properties.latestRevisionName,image:properties.template.containers[0].image}','-o','json','--only-show-errors'],{encoding:'utf8'});
  if(live.status!==0)throw new Error('SMOKE_CURRENT_REVISION_UNAVAILABLE');
  const deployed=JSON.parse(live.stdout),definition=smokeJobDefinition({source,input,deployed});
  const directory=mkdtempSync(join(tmpdir(),'develocrm-sbk-job-')),path=join(directory,'execution.json');
  writeFileSync(path,JSON.stringify(definition),{mode:0o600});
  const result=spawnSync('/opt/homebrew/bin/az',['containerapp','job','start','--name','job-develocrm-hold-expiry','--resource-group','rg-develocrm-pilot','--yaml',path,'--query','name','-o','tsv','--only-show-errors'],{encoding:'utf8'});
  if(result.status!==0)throw new Error('SMOKE_JOB_START_FAILED_INSPECT_EXECUTIONS_BEFORE_RETRY');
  console.log(JSON.stringify({execution:result.stdout.trim(),mode,projectId:projectId??null,profile:profile??'synthetic',matchingRevision:deployed.ready,scheduledJobChanged:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  console.error(/^SMOKE_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'SMOKE_JOB_FAILED');process.exitCode=1;
});
