import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {inspectDocxTemplate,renderDocxTemplate} from '../src/documents/docx-template.js';

// Offline content-review samples only. Never registers, approves or activates.
const directory=resolve(process.argv[2]??'outputs/contract-review');
for(const kind of ['rs','sbk']){
 const manifest=JSON.parse(await readFile(resolve(directory,`${kind}-review-manifest.json`),'utf8')) as {
  status:string;activationAllowed:boolean;templateSha256:string;sampleIsSynthetic:boolean;
  schema:{fields:Record<string,{required:boolean}>};sampleValues:Record<string,string>;
 };
 if(manifest.status!=='draft'||manifest.activationAllowed||!manifest.sampleIsSynthetic)throw new Error('Review must remain inactive and synthetic');
 const bytes=await readFile(resolve(directory,`${kind}-dejvice-original-review.docx`));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.templateSha256)throw new Error('Review template hash mismatch');
 const fields=Object.keys(manifest.schema.fields).sort();
 if(inspectDocxTemplate(bytes).tokens.join('\0')!==fields.join('\0'))throw new Error('Review schema mismatch');
 const rendered=renderDocxTemplate(bytes,manifest.sampleValues,{allowedTokens:fields,requiredTokens:fields});
 if(inspectDocxTemplate(rendered.bytes).tokens.length)throw new Error('Unresolved review field');
 await writeFile(resolve(directory,`${kind}-review-filled.docx`),rendered.bytes);
 console.log(`${kind}: existing strict renderer, ${fields.length} fields, no unresolved tokens, draft only`);
}
