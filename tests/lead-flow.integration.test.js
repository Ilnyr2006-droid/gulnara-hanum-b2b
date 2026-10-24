'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer}=require('../server');

function request(port,{method='GET',path='/',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method,path,headers},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(body)req.write(body);
    req.end();
  });
}

test('landing page request can submit a catalog quote through the API to a mocked Resend transport',async t=>{
  const envKeys=['PERSONAL_DATA_PROCESSING_APPROVED','RESEND_API_KEY','RESEND_FROM','LEADS_TO'];
  const previousEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=global.fetch;
  let mailRequest;
  process.env.PERSONAL_DATA_PROCESSING_APPROVED='true';
  process.env.RESEND_API_KEY='test-only-key';
  process.env.RESEND_FROM='Test <test@example.invalid>';
  process.env.LEADS_TO='buyer@example.invalid';
  global.fetch=async(url,options)=>{
    mailRequest={url,options};
    return {ok:true,json:async()=>({id:'mock-message-id'})};
  };

  const server=createServer();
  t.after(async()=>{
    global.fetch=originalFetch;
    for(const key of envKeys){
      if(previousEnv[key]===undefined)delete process.env[key];
      else process.env[key]=previousEnv[key];
    }
    await new Promise(resolve=>server.close(resolve));
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const port=server.address().port;

  const page=await request(port);
  assert.equal(page.status,200);
  assert.match(page.body,/id="rfq-form"/);
  assert.match(page.body,/ЛПШМ-2026-44-48/);

  const payload=JSON.stringify({
    kind:'quote',contact:'Ирина',email:'buyer@example.invalid',consent:true,website:'',
    items:[{sku:'КПШМ-2026-2',qty:10}],comment:'Пробная проверка интеграции'
  });
  const malformed='{';
  const requestHeaders={
    'Content-Type':'application/json','Content-Length':Buffer.byteLength(malformed),
    Origin:`http://127.0.0.1:${port}`
  };
  const insecure=await request(port,{
    method:'POST',path:'/api/lead',headers:{...requestHeaders,'X-Forwarded-Proto':'http'},body:malformed
  });
  assert.equal(insecure.status,403);
  const crossSite=await request(port,{
    method:'POST',path:'/api/lead',headers:{...requestHeaders,Origin:'https://attacker.example'},body:malformed
  });
  assert.equal(crossSite.status,403);

  process.env.PERSONAL_DATA_PROCESSING_APPROVED='false';
  const disabled=await request(port,{
    method:'POST',path:'/api/lead',headers:requestHeaders,body:malformed
  });
  assert.equal(disabled.status,503);
  assert.match(disabled.body,/отключена до утверждения/);
  assert.equal(mailRequest,undefined);

  process.env.PERSONAL_DATA_PROCESSING_APPROVED='true';
  const response=await request(port,{
    method:'POST',path:'/api/lead',
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),Origin:`http://127.0.0.1:${port}`},
    body:payload
  });
  assert.equal(response.status,200,response.body);
  assert.deepEqual(JSON.parse(response.body),{ok:true});
  assert.equal(mailRequest.url,'https://api.resend.com/emails');
  assert.equal(mailRequest.options.method,'POST');
  const email=JSON.parse(mailRequest.options.body);
  assert.deepEqual(email.to,['buyer@example.invalid']);
  assert.match(email.text,/КПШМ-2026-2/);
  assert.match(email.text,/ростовая группа 2 — 170–182 см/);
  assert.match(email.text,/Итого: 10 шт\./);
  assert.match(email.text,/Пробная проверка интеграции/);
});
