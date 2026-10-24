'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../server');

test('malformed request URL returns 400 without rejecting the request handler',async()=>{
  const server=createServer();
  const onRequest=server.listeners('request')[0];
  const response={
    statusCode:200,
    headers:{},
    body:'',
    writeHead(status,headers={}){
      this.statusCode=status;
      this.headers=headers;
    },
    end(body=''){
      this.body+=body;
    }
  };

  await assert.doesNotReject(onRequest({url:'http://[',method:'GET'},response));
  assert.equal(response.statusCode,400);
  assert.equal(response.headers.Connection,'close');
  assert.equal(response.body,'Bad request');
});
