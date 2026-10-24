'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validate,compose,sendMail,LeadError}=require('../lib/lead');

const price={kind:'price',contact:'Ирина',email:'buyer@example.ru',consent:true,website:''};
const quote={kind:'quote',contact:'Павел',email:'purchase@example.ru',consent:true,website:'',company:'ООО Север',phone:'+7 900 111 22 33',comment:'Доставка в Казань',items:[{sku:'top',qty:4},{sku:'breeches',qty:3},{sku:'stirrup-bottoms',qty:3}]};

test('quick price request requires only name, email and consent',()=>{
  const result=validate(price);
  assert.deepEqual(result,{kind:'price',contact:'Ирина',email:'buyer@example.ru'});
  assert.match(compose(result),/Запрос общего оптового прайса/);
  assert.doesNotMatch(compose(result),/Состав партии/);
});
test('multiple model IDs are validated and totaled',()=>{
  const result=validate(quote);
  assert.equal(result.total,10);
  const email=compose(result);
  assert.match(email,/Верх комплекта термобелья — 4 шт/);
  assert.match(email,/Бриджи — 3 шт/);
  assert.match(email,/Кальсоны со штрипками — 3 шт/);
  assert.match(email,/ООО Север/);
  assert.doesNotMatch(email,/longsleeve|breeches|stirrup-bottoms/);
});
test('rejects under-minimum, duplicate, imaginary and fractional model values',()=>{
  const q=(items)=>({...quote,items});
  for(const items of [
    [{sku:'breeches',qty:9}],
    [{sku:'breeches',qty:8},{sku:'breeches',qty:2}],
    [{sku:'FAKE',qty:12}],
    [{sku:'breeches',qty:10.5}],
  ])assert.throws(()=>validate(q(items)),LeadError);
});
test('rejects invalid email, no consent, oversized input',()=>{
  assert.throws(()=>validate({...price,email:'nobody'}),LeadError);
  for(const separator of ['\r','\n','\t','\u0085','\u2028','\u2029'])
    assert.throws(()=>validate({...price,email:`buyer${separator}@example.ru`}),LeadError);
  for(const formatMark of ['\u061c','\u200c','\u200d','\u200e','\u200f','\u2061','\u206a'])
    assert.throws(()=>validate({...price,email:`buyer${formatMark}@example.ru`}),LeadError);
  assert.throws(()=>validate({...price,consent:false}),LeadError);
  assert.throws(()=>validate({...price,contact:'x'.repeat(101)}),LeadError);
  assert.throws(()=>validate({...price,contact:'Ирина\nКомпания: подмена'}),LeadError);
  assert.throws(()=>validate({...quote,company:'ООО Север\nТелефон: подмена'}),LeadError);
  assert.throws(()=>validate({...quote,phone:'+7 900 111 22 33\tEmail: подмена'}),LeadError);
  for(const separator of ['\r','\n','\t','\u0085','\u2028','\u2029'])
    assert.throws(()=>validate({...price,contact:`Ирина${separator}Компания: подмена`}),LeadError);
  for(const control of ['\u0086','\u200b','\u202e','\u2066','\ufeff'])
    assert.throws(()=>validate({...price,contact:`Ирина${control}Клиент`}),LeadError);
});
test('keeps multiline comments visually inside the comment block',()=>{
  const email=compose(validate({...quote,comment:'Пожелание по доставке\nEmail: пример подмены@example.ru\u2028Третья строка\tс отступом'}));
  assert.match(email,/Комментарий:\n  Пожелание по доставке\n  Email: пример подмены@example\.ru\n  Третья строка  с отступом/);
});
test('spam honeypot does not produce a lead',()=>{
  assert.deepEqual(validate({...price,website:'https://spam.example'}),{bot:true});
});
test('provider receives proper destination, Reply-To and email body without exposing keys',async()=>{
  let got;
  const fake=async(url,options)=>{
    got={url,options};
    return {ok:true,json:async()=>({id:'test-id'})};
  };
  const delivered=await sendMail(validate(quote),{
    RESEND_API_KEY:'re_secret_in_test',RESEND_FROM:'Leads <leads@example.org>',LEADS_TO:'gh150874@mail.ru'
  },fake);
  assert.equal(delivered.id,'test-id');
  assert.equal(got.url,'https://api.resend.com/emails');
  assert.equal(got.options.headers.Authorization,'Bearer re_secret_in_test');
  const email=JSON.parse(got.options.body);
  assert.deepEqual(email.to,['gh150874@mail.ru']);
  assert.equal(email.reply_to,'purchase@example.ru');
  assert.match(email.text,/Верх комплекта термобелья — 4 шт/);
  assert.match(email.text,/Бриджи — 3 шт/);
  assert.match(email.text,/Кальсоны со штрипками — 3 шт/);
  assert.doesNotMatch(email.text,/longsleeve|breeches|stirrup-bottoms/);
});
test('returns explicit 503 with missing mail credentials',async()=>{
  await assert.rejects(()=>sendMail(validate(price),{},async()=>{}),error=>error.status===503);
});
