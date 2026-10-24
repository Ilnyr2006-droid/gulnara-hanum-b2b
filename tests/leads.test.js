'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validate,compose,sendMail,LeadError}=require('../lib/lead');

const price={kind:'price',contact:'Ирина',email:'buyer@example.ru',consent:true,website:''};
const catalog=[
  {sku:'ЛПШМ-2026-44-48',description:'Лонгслив с удлинённым рукавом',details:'44–48, российский размер'},
  {sku:'ЛПШМ-2026-50-54',description:'Лонгслив с удлинённым рукавом',details:'50–54, российский размер'},
  {sku:'ШПШМ-2026-46-48',description:'Бриджи (удлинённые шорты)',details:'46–48, российский размер'},
  {sku:'ШПШМ-2026-50-52',description:'Бриджи (удлинённые шорты)',details:'50–52, российский размер'},
  {sku:'ШПШМ-2026-54-56',description:'Бриджи (удлинённые шорты)',details:'54–56, российский размер'},
  {sku:'КПШМ-2026-1',description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 1 — 158–170 см'},
  {sku:'КПШМ-2026-2',description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 2 — 170–182 см'},
  {sku:'КПШМ-2026-3',description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 3 — 182–194 см'}
];
const quote={kind:'quote',contact:'Павел',email:'purchase@example.ru',consent:true,website:'',phone:'+7 900 111 22 33',comment:'Доставка в Казань',items:[{sku:catalog[0].sku,qty:4},{sku:catalog[2].sku,qty:3},{sku:catalog[5].sku,qty:3}]};

test('quick price request requires only name, email and consent',()=>{
  const result=validate(price);
  assert.deepEqual(result,{kind:'price',contact:'Ирина',email:'buyer@example.ru'});
  assert.match(compose(result),/Запрос общего оптового прайса/);
  assert.doesNotMatch(compose(result),/Состав партии/);
});
test('all eight article variants are validated and composed with size and height details',()=>{
  const result=validate({...quote,items:catalog.map(({sku})=>({sku,qty:2}))});
  assert.equal(result.total,16);
  assert.equal(result.items.length,8);
  const email=compose(result);
  for(const item of catalog)
    assert.ok(email.includes(`• ${item.description} — ${item.sku}; ${item.details} — 2 шт.`),`missing article details for ${item.sku}`);
  assert.doesNotMatch(email,/Организация/);
  assert.doesNotMatch(email,/longsleeve|breeches|stirrup-bottoms/);
});
test('rejects under-minimum, duplicate, imaginary and fractional article values and caps the catalog at eight',()=>{
  const q=(items)=>({...quote,items});
  for(const items of [
    [{sku:catalog[0].sku,qty:9}],
    [{sku:catalog[0].sku,qty:8},{sku:catalog[0].sku,qty:2}],
    [{sku:'FAKE-ARTICLE',qty:12}],
    [{sku:catalog[0].sku,qty:10.5}],
    [...catalog.map(({sku})=>({sku,qty:2})),{sku:'EXTRA-ARTICLE',qty:1}],
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
test('ignores the removed organization field and keeps it out of email content',()=>{
  const result=validate({...quote,company:{unexpected:'ООО Север\nEmail: подмена'}});
  assert.equal(Object.hasOwn(result,'company'),false);
  assert.doesNotMatch(compose(result),/Организация|ООО Север|Email: подмена/);
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
    RESEND_API_KEY:'re_secret_in_test',RESEND_FROM:'Leads <leads@example.org>',LEADS_TO:'gh150874@mail.ru',PERSONAL_DATA_PROCESSING_APPROVED:'true'
  },fake);
  assert.equal(delivered.id,'test-id');
  assert.equal(got.url,'https://api.resend.com/emails');
  assert.equal(got.options.headers.Authorization,'Bearer re_secret_in_test');
  const email=JSON.parse(got.options.body);
  assert.deepEqual(email.to,['gh150874@mail.ru']);
  assert.equal(email.reply_to,'purchase@example.ru');
  assert.doesNotMatch(email.text,/Организация/);
  assert.match(email.text,/Лонгслив с удлинённым рукавом — ЛПШМ-2026-44-48; 44–48, российский размер — 4 шт/);
  assert.match(email.text,/Бриджи \(удлинённые шорты\) — ШПШМ-2026-46-48; 46–48, российский размер — 3 шт/);
  assert.match(email.text,/Кальсоны со штрипками — КПШМ-2026-1; OneSize, российский размер 46–56; ростовая группа 1 — 158–170 см — 3 шт/);
  assert.doesNotMatch(email.text,/longsleeve|breeches|stirrup-bottoms/);
});
test('blocks mail delivery until personal-data processing is explicitly approved',async()=>{
  let calls=0;
  const fake=async()=>{calls++;return {ok:true,json:async()=>({id:'unexpected'})};};
  const credentials={RESEND_API_KEY:'re_secret_in_test',RESEND_FROM:'Leads <leads@example.org>'};
  for(const approval of [undefined,'false']){
    const env={...credentials};
    if(approval!==undefined)env.PERSONAL_DATA_PROCESSING_APPROVED=approval;
    await assert.rejects(()=>sendMail(validate(quote),env,fake),error=>error.status===503);
  }
  assert.equal(calls,0);
});
test('returns explicit 503 with missing mail credentials',async()=>{
  await assert.rejects(()=>sendMail(validate(price),{PERSONAL_DATA_PROCESSING_APPROVED:'true'},async()=>{}),error=>error.status===503);
});
