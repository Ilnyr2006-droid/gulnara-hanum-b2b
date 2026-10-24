'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/lead');

test('ignores caller-supplied X-Real-IP unless trusted ingress is explicitly enabled',async()=>{
  const previous=process.env.TRUST_X_REAL_IP;
  process.env.TRUST_X_REAL_IP='false';
  try{
    const remoteAddress=`test-socket-${process.pid}-${Date.now()}`;
    const statuses=[];
    for(let i=1;i<=6;i++){
      const req={
        method:'POST',
        headers:{
          origin:'https://landing.example',
          host:'landing.example',
          'content-type':'application/json',
          'x-real-ip':`198.51.100.${i}`
        },
        socket:{remoteAddress},
        body:{}
      };
      const res={
        statusCode:0,
        headers:{},
        setHeader(name,value){this.headers[name]=value;},
        end(body){this.body=body;}
      };
      await handler(req,res);
      statuses.push(res.statusCode);
    }
    assert.deepEqual(statuses,[400,400,400,400,400,429]);
  }finally{
    if(previous===undefined)delete process.env.TRUST_X_REAL_IP;
    else process.env.TRUST_X_REAL_IP=previous;
  }
});
