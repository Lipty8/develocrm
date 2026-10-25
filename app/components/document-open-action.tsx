import {ExternalLink} from 'lucide-react';

export function DocumentOpenAction({webUrl}:{webUrl:string|null}){
  if(!webUrl)return null;
  try{const url=new URL(webUrl);if(url.protocol!=='https:'||!url.hostname.endsWith('.sharepoint.com')||url.username||url.password)return null;}catch{return null;}
  return <a className="secondary-button" href={webUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Otevřít v SharePointu</a>;
}
