'use strict';

// Progressive enhancement only: all descriptive content exists in HTML without JS.
const models = [
  {id:'top', name:'Верх комплекта термобелья'},
  {id:'breeches', name:'Бриджи (удлинённые шорты)'},
  {id:'stirrup-bottoms', name:'Кальсоны со штрипками'}
];
const $ = (id) => document.getElementById(id);
const cart = new Map();
const select = $('model-select');
const selectedItems = $('selected-items');
const total = $('total-qty');
const feedback = $('qty-feedback');
const form = $('rfq-form');
const hint = $('form-hint');

function quantity(value) {
  const n=Number(value);
  return Number.isSafeInteger(n) && n>=1 && n<=99999 ? n : null;
}
function countTotal(){return [...cart.values()].reduce((sum,qty)=>sum+qty,0);}
function updateSummary(){
  const n=countTotal();total.textContent=`${n.toLocaleString('ru-RU')} шт.`;
  feedback.classList.toggle('ready',n>=10);
  feedback.textContent=n>=10?`Партия от 10 изделий сформирована (${n.toLocaleString('ru-RU')} шт.).`:
    n>0?`Добавьте ещё ${10-n} шт. до минимальной партии.`:
    'Вы можете запросить общий прайс без выбранных моделей. Расчёт партии — от 10 изделий.';
}
function renderCart(){
  selectedItems.replaceChildren();
  if(!cart.size){
    const p=document.createElement('p');p.className='empty-cart';
    p.textContent='Модели не выбраны. Можно запросить общий прайс или добавить модели для расчёта партии.';
    selectedItems.appendChild(p);
  }
  for(const [modelId,qty] of cart){
    const info=models.find(item=>item.id===modelId);
    const row=document.createElement('div');row.className='cart-row';
    const text=document.createElement('div');text.className='cart-row-label';
    const strong=document.createElement('strong');strong.textContent=info.name;
    text.append(strong);
    const input=document.createElement('input');input.type='number';input.min='1';input.max='99999';input.step='1';input.inputMode='numeric';input.value=qty;
    input.setAttribute('aria-label',`Количество для ${info.name}`);
    input.addEventListener('change',()=>{
      const parsed=quantity(input.value);
      if(!parsed){input.value=cart.get(modelId);feedback.textContent='Укажите целое количество от 1 до 99 999.';return;}
      // Do not recreate a focused number input during its change event:
      // removing it would dispatch blur/change recursively in some browsers.
      cart.set(modelId,parsed);input.value=String(parsed);updateSummary();
    });
    const remove=document.createElement('button');remove.type='button';remove.className='cart-remove';remove.textContent='×';
    remove.setAttribute('aria-label',`Удалить ${info.name}`);
    remove.addEventListener('click',()=>{cart.delete(modelId);renderCart();});
    row.append(text,input,remove);selectedItems.appendChild(row);
  }
  updateSummary();
}
function addModel(modelId,qty=10){
  if(!models.some(item=>item.id===modelId)) return false;
  if(!quantity(qty)){hint.textContent='Количество должно быть целым числом от 1 до 99 999.';return false;}
  const next=(cart.get(modelId)||0)+qty;
  if(next>99999){hint.textContent='Для одной модели можно указать не больше 99 999 изделий.';return false;}
  cart.set(modelId,next);renderCart();return true;
}
$('add-model').addEventListener('click',()=>{
  if(!select.value){select.focus();hint.textContent='Сначала выберите модель.';return;}
  const qty=quantity($('model-qty').value);
  if(!qty){$('model-qty').focus();hint.textContent='Укажите целое количество от 1 до 99 999.';return;}
  if(addModel(select.value,qty))hint.textContent='Модель добавлена в состав заявки. При необходимости измените количество в списке ниже.';
});
function buildMessage(){
  const withItems=cart.size>0;
  const lines=[
    withItems
      ? 'Здравствуйте! Прошу рассчитать оптовую партию термобелья и предоставить актуальный прайс.'
      : 'Здравствуйте! Прошу предоставить актуальный оптовый прайс на термобельё и условия сотрудничества.',
    '', 'Контактное лицо: '+$('contact').value.trim(),
    'Email: '+$('email').value.trim(),
    'Телефон: '+($('phone').value.trim()||'не указан')
  ];
  if(withItems){
    lines.push('', 'Состав запрашиваемой партии:');
    for(const [modelId,qty] of cart){
      const item=models.find(x=>x.id===modelId);
      lines.push(`— ${item.name} — ${qty} шт.`);
    }
    lines.push(`Итого: ${countTotal()} шт.`);
  }else{
    lines.push('', 'Прошу выслать общий оптовый прайс. Состав партии уточним после ознакомления с условиями.');
  }
  const comment=$('comment').value.trim();
  if(comment)lines.push('','Комментарий: '+comment);
  lines.push('','Пожалуйста, уточните цены, наличие размеров и комплектацию для выбранной модели и партии, сроки и условия доставки.');
  return lines.join('\n');
}
function validateQuote(){
  if(cart.size>0 && (countTotal()<10 || countTotal()>200000)){
    feedback.textContent='Для расчёта партии укажите суммарно от 10 до 200 000 изделий.';
    feedback.classList.remove('ready');
    select.focus();return false;
  }
  if(!form.reportValidity())return false;
  return true;
}
// Requests are delivered through the same-origin backend, never through a public API key.
// Preserve a mailto fallback for local preview and cleartext IP staging.
const priceForm = $('price-form');
function mailtoUrl(subject, message){
  return `mailto:gh150874@mail.ru?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}
async function sendLead({sourceForm, kind, payload, statusEl, fallbackEl, subject, message, onSuccess}){
  const submitButton=sourceForm.querySelector('button[type="submit"]');
  statusEl.classList.remove('is-error','is-success');
  fallbackEl.hidden=true;
  fallbackEl.href=mailtoUrl(subject,message);
  if(window.location.protocol!=='https:'){
    statusEl.classList.add('is-error');
    statusEl.textContent=window.location.protocol==='file:'
      ? 'Это локальный просмотр сайта. Для отправки через сайт потребуется публикация и настройка сервера. Пока можно отправить письмо вручную.'
      : 'Отправка через форму доступна только по защищённому HTTPS-адресу. Пока можно открыть письмо вручную.';
    fallbackEl.hidden=false;
    return;
  }
  submitButton.disabled=true;
  statusEl.textContent='Передаём запрос на сервер…';
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch('/api/lead',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({kind,...payload}),
      signal:controller.signal
    });
    let result={};
    try{result=await response.json();}catch(e){}
    if(!response.ok||!result.ok){
      const errors={
        400:'Проверьте заполнение полей и попробуйте ещё раз.',
        404:'На этом хостинге не подключён обработчик заявок.',
        429:'Слишком много запросов. Попробуйте чуть позже.',
        503:'Отправка ещё не настроена на сервере.',
        502:'Почтовый сервис временно не принял заявку.'
      };
      throw new Error(errors[response.status]||'Не удалось передать запрос на сервер.');
    }
    statusEl.classList.add('is-success');
    statusEl.textContent='Запрос принят сервисом отправки. Мы свяжемся с вами по указанному email.';
    fallbackEl.hidden=true;
    onSuccess?.();
  }catch(error){
    statusEl.classList.add('is-error');
    statusEl.textContent=error.name==='AbortError'?'Сервер долго не отвечает. Попробуйте позже или отправьте письмо вручную.':
      (error instanceof TypeError?'Нет соединения с сервером. Можно отправить письмо вручную.':error.message);
    fallbackEl.hidden=false;
  }finally{
    clearTimeout(timeout);
    submitButton.disabled=false;
  }
}
priceForm.addEventListener('submit',event=>{
  event.preventDefault();
  if(!priceForm.reportValidity())return;
  const payload={
    contact:priceForm.elements.contact.value.trim(),
    email:priceForm.elements.email.value.trim(),
    consent:priceForm.elements.consent.checked,
    website:priceForm.elements.website.value
  };
  const message=`Здравствуйте! Прошу прислать актуальный оптовый прайс на термобельё из шерсти мериноса и условия сотрудничества.\n\nИмя: ${payload.contact}\nEmail: ${payload.email}`;
  void sendLead({sourceForm:priceForm,kind:'price',payload,statusEl:$('price-status'),fallbackEl:$('price-email-fallback'),subject:'Запрос оптового прайса — Гульнара Ханум',message,onSuccess:()=>priceForm.reset()});
});
form.addEventListener('submit',event=>{
  event.preventDefault();
  if(!cart.size){hint.textContent='Для расчёта добавьте хотя бы одну модель. Для общего прайса используйте короткую форму выше.';select.focus();return;}
  if(!validateQuote())return;
  const items=Array.from(cart,([sku,qty])=>({sku,qty}));
  const payload={
    contact:$('contact').value.trim(),email:$('email').value.trim(),
    phone:$('phone').value.trim(),
    comment:$('comment').value.trim(),items,
    consent:form.elements.consent.checked,website:form.elements.website.value
  };
  void sendLead({sourceForm:form,kind:'quote',payload,statusEl:hint,fallbackEl:$('quote-email-fallback'),subject:'Расчёт оптовой партии — Гульнара Ханум',message:buildMessage(),onSuccess:()=>{
    form.reset();cart.clear();renderCart();
  }});
});
$('copy-quote').addEventListener('click',async()=>{
  if(!validateQuote())return;
  const text=buildMessage();
  try{
    if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(text);}
    else{
      const el=document.createElement('textarea');el.value=text;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);
      try{el.focus();el.select();if(!document.execCommand('copy'))throw Error('copy failed');}
      finally{el.remove();}
    }
    hint.textContent='Текст заявки скопирован. Его можно вставить в письмо или мессенджер.';
  }catch(error){hint.textContent='Автоматическое копирование недоступно в этом браузере. Попробуйте кнопку подготовки письма.';}
});
renderCart();

const mobileToggle=document.querySelector('.mobile-menu-toggle');
const menu=$('primary-nav');
mobileToggle.addEventListener('click',()=>{
  const open=mobileToggle.getAttribute('aria-expanded')!=='true';
  mobileToggle.setAttribute('aria-expanded',String(open));
  mobileToggle.innerHTML=open?'<span aria-hidden="true">×</span> Закрыть':'<span aria-hidden="true">☰</span> Меню';
  menu.classList.toggle('is-open',open);
});
menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{
  menu.classList.remove('is-open');mobileToggle.setAttribute('aria-expanded','false');
  mobileToggle.innerHTML='<span aria-hidden="true">☰</span> Меню';
}));

// Keep the mobile navigation predictable for keyboard users.
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && mobileToggle.getAttribute('aria-expanded')==='true'){
    menu.classList.remove('is-open');
    mobileToggle.setAttribute('aria-expanded','false');
    mobileToggle.innerHTML='<span aria-hidden="true">☰</span> Меню';
    mobileToggle.focus();
  }
});

// Mark enhanced controls active only after all handlers were registered.
document.documentElement.classList.add('has-js');
