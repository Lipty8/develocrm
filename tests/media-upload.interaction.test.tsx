import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { ApiMediaRepository } from "../app/repositories/media-repository";
import type { ApiFetch } from "../app/lib/api-client";
import { MEDIA_UPLOAD_CHUNK_SIZE, mediaChunkBounds, validateMediaUploadDescriptor } from "../app/lib/media-upload-protocol";

test("request o velikosti selhávajícího JPG se rozdělí bezpečně pod 1 MB",()=>{
  const size=1_173_883;
  const upload=validateMediaUploadDescriptor({entityType:"project",entityId:"b90bfb36-cf5c-442b-aa0b-83785723cbff",kind:"cover",fileName:"cover.jpg",mimeType:"image/jpeg",size});
  assert.equal(upload.chunkCount,2);
  assert.deepEqual(mediaChunkBounds(0,size),{start:0,end:MEDIA_UPLOAD_CHUNK_SIZE});
  assert.deepEqual(mediaChunkBounds(1,size),{start:MEDIA_UPLOAD_CHUNK_SIZE,end:size});
  assert.ok(MEDIA_UPLOAD_CHUNK_SIZE<1024*1024);
});

test("upload odešle větší JPG po částech, dokončí binding a načte chráněné médium",async()=>{
  const calls:Array<{method:string;url:string;size:number}>=[];
  const size=1_173_883;
  const fetcher:ApiFetch=async(input,init={})=>{
    const url=String(input),method=(init.method||"GET").toUpperCase();
    const bodySize=init.body instanceof Blob?init.body.size:typeof init.body==="string"?new TextEncoder().encode(init.body).byteLength:0;
    calls.push({method,url,size:bodySize});
    if(method==="POST")return Response.json({uploadId:"10000000-0000-4000-8000-000000000001",chunkSize:MEDIA_UPLOAD_CHUNK_SIZE,chunkCount:2},{status:201});
    if(method==="PUT")return new Response(null,{status:204});
    if(method==="PATCH")return Response.json({media:{id:"media-1",entityType:"project",entityId:"b90bfb36-cf5c-442b-aa0b-83785723cbff",kind:"cover",fileName:"cover.jpg",mimeType:"image/jpeg",url:"/api/media/file/private"}},{status:201});
    return new Response(new Blob(["image"],{type:"image/jpeg"}),{status:200,headers:{"content-type":"image/jpeg"}});
  };
  const repository=new ApiMediaRepository(fetcher);
  const media=await repository.upload("project","b90bfb36-cf5c-442b-aa0b-83785723cbff","cover",new File([new Uint8Array(size)],"cover.jpg",{type:"image/jpeg"}) as unknown as globalThis.File);
  assert.equal(media.mimeType,"image/jpeg");
  assert.deepEqual(calls.map(call=>call.method),["POST","PUT","PUT","PATCH","GET"]);
  assert.deepEqual(calls.filter(call=>call.method==="PUT").map(call=>call.size),[MEDIA_UPLOAD_CHUNK_SIZE,size-MEDIA_UPLOAD_CHUNK_SIZE]);
  assert.ok(calls.every(call=>call.method!=="PUT"||call.size<1024*1024));
});

test("selhání části uploadu vyvolá úklid relace",async()=>{
  const methods:string[]=[];
  const fetcher:ApiFetch=async(_input,init={})=>{
    const method=(init.method||"GET").toUpperCase();methods.push(method);
    if(method==="POST")return Response.json({uploadId:"10000000-0000-4000-8000-000000000001",chunkSize:MEDIA_UPLOAD_CHUNK_SIZE,chunkCount:2},{status:201});
    if(method==="PUT")return Response.json({error:"Část souboru nelze uložit",correlationId:"upload-test"},{status:502});
    if(method==="DELETE")return new Response(null,{status:204});
    throw new Error("neočekávaný request");
  };
  const repository=new ApiMediaRepository(fetcher);
  await assert.rejects(repository.upload("project","b90bfb36-cf5c-442b-aa0b-83785723cbff","cover",new File([new Uint8Array(900_000)],"cover.jpg",{type:"image/jpeg"}) as unknown as globalThis.File),/upload-test/);
  assert.deepEqual(methods,["POST","PUT","DELETE"]);
});
