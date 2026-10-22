import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from './leads.js';

test('contact-only discovery returns real Places identity without performing a website audit',async()=>{
  const originalFetch=globalThis.fetch;const oldKey=process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY='synthetic-test-key';let externalReads=0;
  globalThis.fetch=async(input,options)=>{
    assert(String(input).startsWith('https://maps.googleapis.com/maps/api/place/details/json'));
    externalReads++;
    return Response.json({status:'OK',result:{website:'https://example.invalid'}});
  };
  const app=express();app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',()=>resolve()));
  try{
    const address=server.address();assert(address&&typeof address==='object');
    const response=await originalFetch('http://127.0.0.1:'+address.port+'/api/score-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placeId:'synthetic-place',name:'Synthetic Consultancy',contactOnly:true})});
    const result=await response.json() as Record<string,unknown>;
    assert.equal(response.status,200);assert.equal(result.website,'https://example.invalid');
    assert.equal(result.status,'discovered');assert.equal(result.email,null);
    assert.equal(externalReads,1);assert.equal(result.pillars,undefined);
  }finally{
    globalThis.fetch=originalFetch;
    if(oldKey===undefined)delete process.env.GOOGLE_PLACES_API_KEY;else process.env.GOOGLE_PLACES_API_KEY=oldKey;
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
