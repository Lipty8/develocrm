import type {R2Bucket,R2Object,R2ObjectBody,R2GetOptions,R2PutOptions} from '@cloudflare/workers-types';

// Cloudflare's ambient web classes differ from lib.dom's declarations. Describe
// the binding boundary in the application's DOM realm, retaining typed R2 metadata.
type MediaObjectBody=Omit<R2ObjectBody,'body'|'writeHttpMetadata'>&{
  body:ReadableStream<Uint8Array>;
  writeHttpMetadata(headers:Headers):void;
};
export type MediaBucket=Pick<R2Bucket,'delete'|'head'>&{
  get(key:string,options?:R2GetOptions):Promise<MediaObjectBody|null>;
  put(key:string,value:ReadableStream<Uint8Array>|ArrayBuffer|ArrayBufferView|string|null,options?:R2PutOptions):Promise<R2Object|null>;
};
