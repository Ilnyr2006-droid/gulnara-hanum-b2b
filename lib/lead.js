'use strict';

// Shared validation and transport for Node and Vercel. All secrets remain server side.
const SKUS = new Map([
  ['ЛПШМ-2026-44-48', {description:'Лонгслив с удлинённым рукавом',details:'44–48, российский размер'}],
  ['ЛПШМ-2026-50-54', {description:'Лонгслив с удлинённым рукавом',details:'50–54, российский размер'}],
  ['ШПШМ-2026-46-48', {description:'Бриджи (удлинённые шорты)',details:'46–48, российский размер'}],
  ['ШПШМ-2026-50-52', {description:'Бриджи (удлинённые шорты)',details:'50–52, российский размер'}],
  ['ШПШМ-2026-54-56', {description:'Бриджи (удлинённые шорты)',details:'54–56, российский размер'}],
  ['КПШМ-2026-1', {description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 1 — 158–170 см'}],
  ['КПШМ-2026-2', {description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 2 — 170–182 см'}],
  ['КПШМ-2026-3', {description:'Кальсоны со штрипками',details:'OneSize, российский размер 46–56; ростовая группа 3 — 182–194 см'}]
]);

class LeadError extends Error {
  constructor(code, message) { super(message); this.status=code; }
}
function clean(value,max=100){
  if(value === undefined || value === null) return '';
  if(typeof value !== 'string') throw new LeadError(400,'Некорректный тип поля');
  const v=value.trim();
  if(v.length>max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\u200b\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(v)) throw new LeadError(400,'Недопустимое значение поля');
  return v;
}
function cleanLine(value,max=100){
  const v=clean(value,max);
  if(/[\r\n\t\u0085\u2028\u2029]/.test(v)) throw new LeadError(400,'Поле должно быть в одну строку');
  return v;
}
function validate(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new LeadError(400,'Неверный запрос');
  const kind=raw.kind;
  if(kind!=='price' && kind!=='quote') throw new LeadError(400,'Неизвестный тип заявки');
  // Quiet honeypot: avoid emailing automated submissions.
  if(clean(raw.website,200)) return {bot:true};
  if(raw.consent!==true) throw new LeadError(400,'Необходимо согласие на обработку данных');
  const contact=cleanLine(raw.contact,100);
  const email=cleanLine(raw.email,160);
  if(contact.length<2 || /\p{Cf}/u.test(email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email))
    throw new LeadError(400,'Заполните имя и email');
  if(kind==='price') return {kind,contact,email};
  const phone=cleanLine(raw.phone,40);
  const comment=clean(raw.comment,800);
  if(!Array.isArray(raw.items) || raw.items.length<1 || raw.items.length>SKUS.size)
    throw new LeadError(400,`Выберите от 1 до ${SKUS.size} артикулов`);
  let total=0;
  const unique=new Set();
  const items=raw.items.map((rawItem)=>{
    if(!rawItem || typeof rawItem!=='object' || Array.isArray(rawItem))
      throw new LeadError(400,'Неверная позиция');
    const sku=clean(rawItem.sku,40);
    if(!SKUS.has(sku) || unique.has(sku)) throw new LeadError(400,'Неверный или повторяющийся артикул');
    unique.add(sku);
    const qty=rawItem.qty;
    if(!Number.isSafeInteger(qty) || qty<1 || qty>99999) throw new LeadError(400,'Некорректное количество');
    total+=qty;
    return {sku,...SKUS.get(sku),qty};
  });
  if(total<10 || total>200000) throw new LeadError(400,'Партия должна содержать от 10 до 200 000 изделий');
  return {kind,contact,email,phone,comment,items,total};
}
function compose(lead){
  const lines=[lead.kind==='price' ? 'Запрос общего оптового прайса' : 'Запрос расчёта оптовой партии',
    '',`Контактное лицо: ${lead.contact}`,`Email: ${lead.email}`];
  if(lead.kind==='quote'){
    lines.push(`Телефон: ${lead.phone||'не указан'}`, '', 'Состав партии:');
    for(const item of lead.items)lines.push(`• ${item.description} — ${item.sku}; ${item.details} — ${item.qty} шт.`);
    lines.push(`Итого: ${lead.total} шт.`);
    if(lead.comment)lines.push('','Комментарий:',...lead.comment.split(/\r\n|[\r\n\u0085\u2028\u2029]/).map(line=>`  ${line.replace(/\t/g,'  ')}`));
  }
  lines.push('','Пожалуйста, отправьте актуальные оптовые цены и условия сотрудничества.');
  return lines.join('\n');
}
async function sendMail(lead,env=process.env,fetchImpl=fetch){
  const key=env.RESEND_API_KEY;
  const sender=env.RESEND_FROM;
  const destination=env.LEADS_TO || 'gh150874@mail.ru';
  if(env.PERSONAL_DATA_PROCESSING_APPROVED!=='true')
    throw new LeadError(503,'Отправка заявок отключена до утверждения обработки персональных данных');
  if(!key || !sender) throw new LeadError(503,'Почтовая отправка ещё не подключена');
  const res=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:sender,
      to:[destination],
      reply_to:lead.email,
      subject:lead.kind==='price'?'[Сайт] Запрос оптового прайса':'[Сайт] Расчёт оптовой партии',
      text:compose(lead)
    }),
    signal:AbortSignal.timeout(10000)
  });
  if(!res.ok) throw new LeadError(502,'Почтовый сервис не принял запрос');
  return await res.json();
}
module.exports={validate,compose,sendMail,LeadError,SKUS};
