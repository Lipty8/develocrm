import {documentMaxBytes} from '../../backend/src/documents/file-limits';
import type {IdentitySession} from '../repositories/identity-repository';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isDocumentEntityId=(value:string|undefined):value is string=>Boolean(value&&uuid.test(value));
const fileTypes:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
export const DOCUMENT_FILE_ACCEPT=Object.keys(fileTypes).map(extension=>`.${extension}`).join(',');
export function validateDocumentFile(file:Pick<File,'name'|'type'|'size'>):string{
  if(!file.name.trim()||file.name!==file.name.trim()||file.name.length>240||/[\\/\0\r\n]/.test(file.name)||file.name.includes('..'))throw new Error('Neplatný název souboru.');
  const expected=fileTypes[file.name.split('.').at(-1)?.toLowerCase()??''];
  if(!expected||(file.type&&file.type!==expected))throw new Error('Nepodporovaný formát souboru.');
  const limit=documentMaxBytes(expected,file.name);
  if(!Number.isSafeInteger(file.size)||file.size<1)throw new Error('Soubor je prázdný.');
  if(file.size>limit)throw new Error(`Soubor je příliš velký. Maximální velikost je ${limit/1024/1024} MB.`);
  return expected;
}
export type UploadProject={id:string;name:string};
export function documentUploadProjects(projects:UploadProject[],workspace:IdentitySession['workspace']):UploadProject[]{
  const allowed=(permissions:string[])=>permissions.some(p=>p==='documents.upload'||p==='documents.create');
  return projects.filter(project=>isDocumentEntityId(project.id)&&(allowed(workspace.permissions)||allowed(workspace.projectScopes?.find(p=>p.projectId===project.id)?.permissions??[])));
}
export function readDocumentBase64(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Soubor se nepodařilo načíst.'));reader.onload=()=>{
    const result=reader.result;if(typeof result!=='string'||!result.includes(',')){reject(new Error('Soubor se nepodařilo načíst.'));return;}resolve(result.slice(result.indexOf(',')+1));
  };reader.readAsDataURL(file);});
}
