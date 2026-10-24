'use strict';
const {isIP}=require('node:net');
const {validate,sendMail,LeadError}=require('../lib/lead');
const rate=new Map();
const MAX_BYTES=12000;
const WINDOW=15*60*1000;
const MAX_RATE_KEYS=10000;
async function loadBody(req){
  if(req.body!==undefined && req.body!==null){
    if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>MAX_BYTES) throw new LeadError(413,'Слишком большой запрос');
    return typeof req.body==='string'?JSON.parse(req.body):req.body;
  }
  const chunks=[];
  let bytes=0;
  for await(const chunk of req){
    const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    bytes+=part.length;
    if(bytes>MAX_BYTES) throw new LeadError(413,'Слишком большой запрос');
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function reply(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(data));
}
function checkOrigin(req){
  if(!req.headers.origin) return true;
  // Reject cross-site requests. Browsers always supply Origin on JSON POST.
  const target=req.headers.host;
  let actual;
  try{actual=new URL(req.headers.origin).host;}catch{return false;}
  return Boolean(target) && actual===target;
}
function usesInsecureForwardedProtocol(req){
  const forwardedProtocol=req.headers['x-forwarded-proto'];
  if(typeof forwardedProtocol!=='string')return false;
  return forwardedProtocol.trim().toLowerCase()==='http';
}
function limitIp(req){
  // This per-instance in-memory guard is best effort; use a shared WAF/rate limit in production.
  const forwardedIp=req.headers['x-real-ip'];
  const ip=process.env.TRUST_X_REAL_IP==='true' && typeof forwardedIp==='string' && isIP(forwardedIp)!==0
    ? forwardedIp
    : (typeof req.socket?.remoteAddress==='string' && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown');
  const now=Date.now();
  for(const [key,value] of rate){if(now-value.start>WINDOW)rate.delete(key);}
  const current=rate.get(ip);
  if(!current){
    if(rate.size>=MAX_RATE_KEYS)return true;
    rate.set(ip,{start:now,count:1});
    return false;
  }
  current.count+=1;
  return current.count>5;
}
async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return reply(res,405,{ok:false,error:'Разрешён только POST'});
  }
  // Trusted reverse proxies provide this header. Keep direct local requests
  // compatible when it is absent, but never accept a lead through explicit HTTP.
  if(usesInsecureForwardedProtocol(req))
    return reply(res,403,{ok:false,error:'Для отправки заявки требуется защищённое HTTPS-соединение'});
  if(!checkOrigin(req))return reply(res,403,{ok:false,error:'Некорректный источник запроса'});
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    return reply(res,415,{ok:false,error:'Ожидается JSON'});
  // Fail closed before parsing or validating any personal data until the
  // operator has explicitly approved the actual processing arrangement.
  if(process.env.PERSONAL_DATA_PROCESSING_APPROVED!=='true')
    return reply(res,503,{ok:false,error:'Отправка заявок отключена до утверждения обработки персональных данных'});
  if(limitIp(req))return reply(res,429,{ok:false,error:'Слишком много запросов'});
  try{
    const lead=validate(await loadBody(req));
    if(lead.bot) return reply(res,200,{ok:true});
    await sendMail(lead);
    return reply(res,200,{ok:true});
  }catch(error){
    if(error instanceof LeadError)return reply(res,error.status,{ok:false,error:error.message});
    if(error instanceof SyntaxError)return reply(res,400,{ok:false,error:'Некорректный JSON'});
    // Do not log contact details or secret values.
    console.error('Lead transport failed:',error?.name||'unknown');
    return reply(res,502,{ok:false,error:'Сервис временно недоступен'});
  }
}
module.exports=handler;
