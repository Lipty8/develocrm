// One-execution override only: never changes the scheduled job or API revision.
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertSmokeInput,assertSyntheticTemplate} from './smoke-sbk-business.mjs';

const [mode,projectId]=process.argv.slice(2);
const input={mode,projectId,tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',membershipId:'40b59cc5-0007-436e-82dd-b30eef82e6eb',
  confirmSyntheticOnly:true,managedIdentityClientId:'134a9cd1-c2d7-4386-b47c-c59260ad460c'};
assertSmokeInput(input);
if(['prepare_rs','prepare_sbk'].includes(mode)){
  const manifest=JSON.parse(readFileSync(new URL('../templates/technical/manifest.json',import.meta.url),'utf8'));
  if(manifest.syntheticOnly!==true||manifest.legalContent!==false)throw new Error('SYNTHETIC_MANIFEST_REQUIRED');
  input.templates={};
  for(const kind of ['rs','sbk']){
    const bytes=readFileSync(new URL(`../templates/technical/TECH72-${kind}-synthetic-template.docx`,import.meta.url));
    assertSyntheticTemplate(bytes,manifest.files[kind].sha256,kind);
    input.templates[kind]={base64:bytes.toString('base64'),sha256:manifest.files[kind].sha256};
  }
}
const source=readFileSync(new URL('./smoke-sbk-business.mjs',import.meta.url),'utf8').replaceAll("from '../dist/","from './backend/dist/");
const command=source+`\nconst outcome=await runSbkSmoke({...${JSON.stringify(input)},databaseUrl:process.env.DATABASE_URL});if(!outcome.ok)process.exitCode=1;`;
const definition={containers:[{name:'job-develocrm-hold-expiry',
  image:'acrdevelocrmpilot9a4c6e.azurecr.io/develocrm-api@sha256:d13a9c67c765762be6bd193f66c3054a953e003f90d46948ec839c606373a144',
  env:[{name:'DATABASE_URL',secretRef:'database-url'}],resources:{cpu:0.5,memory:'1Gi'},command:['node','--input-type=module','-e',command]}]};
const directory=mkdtempSync(join(tmpdir(),'develocrm-tech72-job-')),path=join(directory,'execution.json');
writeFileSync(path,JSON.stringify(definition),{mode:0o600});
const result=spawnSync('/opt/homebrew/bin/az',['containerapp','job','start','--name','job-develocrm-hold-expiry','--resource-group','rg-develocrm-pilot','--yaml',path,'--query','name','-o','tsv'],{encoding:'utf8'});
if(result.status!==0){console.error('SMOKE_JOB_START_FAILED');process.exitCode=1;}
else console.log(JSON.stringify({execution:result.stdout.trim(),mode,projectId:projectId??null,scheduledJobChanged:false}));
