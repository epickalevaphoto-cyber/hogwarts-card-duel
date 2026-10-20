import { Client, Account, ID } from 'https://cdn.jsdelivr.net/npm/appwrite@21.0.0/+esm';
const client=new Client().setEndpoint('https://fra.cloud.appwrite.io/v1').setProject('6ad75c6d0024af9d8bab');
const account=new Account(client);
let user=null,all=[],filter='Все';
const $=s=>document.querySelector(s);
function page(p){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('shown',x.id===p));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));window.scrollTo(0,0)}
document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>page(x.dataset.page));document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>page(x.dataset.go));
const modal=$('#modal');$('#close').onclick=()=>modal.close();
function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function message(t,err=false){const e=$('#authMessage');if(e){e.textContent=t;e.style.color=err?'#ffb7ad':'#d6bb7d'}}
// Appwrite requires an email identifier for email/password sessions. We derive an
// internal, non-deliverable identifier from the login; players never enter email.
// This is a starter implementation, NOT a custom username auth provider.
const LOGIN_RE=/^[a-z0-9][a-z0-9_-]{2,23}$/;
const emailForLogin=login=>`${login}@players.hogwarts-card-duel.invalid`;
function authForm(mode='login'){
 const reg=mode==='register';
 $('#modalBody').innerHTML=`<h3>${reg?'Регистрация':'Вход в Хогвартс'}</h3><form id="authForm" class="auth-form">`+
 `<label>Логин<input name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}" autocomplete="username" placeholder="Например, evitaluna"></label>`+
 (reg?'<label>Игровой никнейм<input name="nickname" required maxlength="60" autocomplete="nickname" placeholder="Как тебя будут видеть другие"></label>':'')+
 `<label>Пароль<input name="password" type="password" minlength="8" required autocomplete="${reg?'new-password':'current-password'}"></label>`+
 (reg?'<label>Повторите пароль<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label>':'')+
 `<button class="primary" type="submit">${reg?'Создать аккаунт':'Войти'}</button></form>`+
 '<p class="auth-hint">Логин: 3–24 символа, латинские буквы, цифры, _ или -. Электронная почта не нужна.</p>'+
 '<p id="authMessage" role="status"></p><button class="secondary" id="authSwitch">'+(reg?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться')+'</button>';
 $('#authSwitch').onclick=()=>authForm(reg?'login':'register');
 $('#authForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget;
  const val=n=>f.elements.namedItem(n).value;
  const login=val('username').trim().toLowerCase(),password=val('password');
  const btn=f.querySelector('[type=submit]');
  if(!LOGIN_RE.test(login)){message('Логин: 3–24 символа, латиница, цифры, _ и -.',true);return}
  btn.disabled=true;message('Подождите…');
  try{
   const email=emailForLogin(login);
   if(reg){
    if(password!==val('confirm'))throw Error('Пароли не совпадают');
    const nickname=val('nickname').trim();if(!nickname)throw Error('Укажите игровой никнейм');
    await account.create({userId:ID.unique(),email,password,name:nickname});
    await account.createEmailPasswordSession({email,password});
    await account.updatePrefs({prefs:{collectionPublic:false,login}});
   }else await account.createEmailPasswordSession({email,password});
   await refresh();modal.close();page('profile');
  }catch(ex){
   const m=String(ex.message||'');
   message(m.includes('already exists')?'Этот логин уже занят. Выбери другой.':
    m.includes('Invalid email')?'Appwrite отклонил внутренний идентификатор. Сообщи мне об ошибке.':
    m.includes('Invalid credentials')?'Неверный логин или пароль.':m||'Ошибка подключения к Appwrite.',true)
  }finally{btn.disabled=false}
 };
 modal.showModal();
}
$('#login').onclick=()=>{if(user)page('profile');else authForm()};
async function refresh(){try{user=await account.get()}catch{user=null}$('#login').textContent=user?'Мой кабинет ↗':'Войти / Регистрация';const area=$('#profileArea');if(!user){area.innerHTML='<h3>Вход не выполнен</h3><p>Войдите или создайте аккаунт, чтобы открыть личный кабинет.</p><button class="primary" id="profileLogin">Войти</button>';$('#profileLogin').onclick=()=>authForm();return}const pub=user.prefs?.collectionPublic===true;area.innerHTML=`<span>✦</span><h3>${safe(user.name)}</h3><p>Логин: <strong>${safe(user.prefs?.login||user.email.split("@")[0])}</strong></p><p>Аккаунт создан. Выдача карт и допуск к дуэлям будут доступны после запуска системы административного подтверждения.</p><label class="privacy-toggle"><input id="publicCollection" type="checkbox" ${pub?'checked':''}> Показывать мою коллекцию другим игрокам (настройка для будущего раздела)</label><p id="prefMessage"></p><button class="secondary" id="logout">Выйти</button>`;$('#publicCollection').onchange=async e=>{try{await account.updatePrefs({prefs:{...user.prefs,collectionPublic:e.target.checked}});user=await account.get();$('#prefMessage').textContent='Настройка сохранена'}catch(ex){$('#prefMessage').textContent=ex.message;e.target.checked=!e.target.checked}};$('#logout').onclick=async()=>{await account.deleteSession({sessionId:'current'});await refresh();page('home')}}
function card(c){let b=document.createElement('button');b.className='card';b.innerHTML=`<img src="${encodeURI(c.image)}" alt="${safe(c.name)}" loading="lazy"><label>${safe(c.name)}</label><small>${safe(c.type)}</small>`;b.onclick=()=>{$('#modalBody').innerHTML=`<img src="${encodeURI(c.image)}" alt="${safe(c.name)}"><h3>${safe(c.name)}</h3><p>${safe(c.type)} · Карта № ${safe(c.id)}</p>`;modal.showModal()};return b}
function draw(){let q=$('#search').value.toLowerCase().trim();let list=all.filter(c=>(filter==='Все'||c.type===filter)&&c.name.toLowerCase().includes(q));$('#cards').replaceChildren(...list.map(card))}
fetch('cards.json').then(r=>{if(!r.ok)throw Error('Не удалось загрузить карты');return r.json()}).then(d=>{all=d;draw()}).catch(console.error);$('#search').oninput=draw;document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('selected',x===b));draw()});refresh();

// Награды и администрация выполняются только на сервере Appwrite Functions.
// Вставьте ID опубликованной функции в следующую строку (не секретный ключ).
const REWARDS_FUNCTION_ID='REPLACE_WITH_FUNCTION_ID';
const fn=new (await import('https://cdn.jsdelivr.net/npm/appwrite@21.0.0/+esm')).Functions(client);
let rewardProfile=null;
async function server(action,extra={}){
 if(REWARDS_FUNCTION_ID==='REPLACE_WITH_FUNCTION_ID')throw Error('Сначала укажите ID функции Appwrite в app.js. См. README.');
 const execution=await fn.createExecution({functionId:REWARDS_FUNCTION_ID,body:JSON.stringify({action,...extra}),async:false,method:'POST',headers:{'content-type':'application/json'}});
 let result;try{result=JSON.parse(execution.responseBody||'{}')}catch{throw Error('Сервер вернул неверный ответ: '+execution.responseBody)}
 if(!result.ok)throw Error(result.error||'Ошибка сервера');return result;
}
const show=(id,t)=>{const el=$(id);if(el)el.textContent=t};
async function updateRewardsUI(){
 if(!user){rewardProfile=null;$('#adminTools').classList.add('hidden');$('#adminLocked').classList.remove('hidden');return}
 try{const {profile}=await server('me');rewardProfile=profile;$('#adminTools').classList.toggle('hidden',!profile.admin);$('#adminLocked').classList.toggle('hidden',!!profile.admin);
  if(!profile.approved)show('#inventoryStatus','Аккаунт ожидает подтверждения администрации.');
  else show('#inventoryStatus','Карты, полученные по одноразовым кодам.');
 }catch(e){show('#inventoryStatus',e.message);show('#adminLocked','Если ты главный администратор, открой инструменты первоначальной настройки ниже. '+e.message);$('#adminTools').classList.remove('hidden')}
}
const oldRefresh=refresh;
refresh=async function(){await oldRefresh();await updateRewardsUI()};
async function drawInventory(){
 if(!user){show('#inventoryStatus','Сначала войдите в аккаунт.');$('#inventoryCards').replaceChildren();return}
 try{const {counts}=await server('inventory');const elements=[];for(const [cardId,n] of Object.entries(counts)){
  const c=all.find(x=>String(x.id)===cardId);if(!c)continue;
  const el=card(c),tag=document.createElement('span');tag.className='count-tag';tag.textContent='× '+n;el.append(tag);elements.push(el);
 }$('#inventoryCards').replaceChildren(...elements);show('#inventoryStatus',elements.length?`Уникальных карт: ${elements.length}. Всего экземпляров: ${Object.values(counts).reduce((a,b)=>a+b,0)}.`:'В коллекции пока нет карт. Получи первую награду по коду!')}
 catch(e){show('#inventoryStatus',e.message)}
}
const oldPage=page;
page=function(p){oldPage(p);if(p==='mycards')drawInventory();if(p==='admin')updateRewardsUI()};
$('#redeemForm').onsubmit=async e=>{e.preventDefault();show('#redeemMessage','Проверяем код…');$('#rewardReveal').replaceChildren();try{
 const r=await server('redeem',{code:$('#rewardCode').value});show('#redeemMessage','✨ Награда получена! Карты добавлены в коллекцию.');
 for(const reward of r.cards){const c=all.find(x=>String(x.id)===String(reward.id));if(c)$('#rewardReveal').append(card(c))}$('#rewardCode').value='';
 }catch(ex){show('#redeemMessage',ex.message)}};
$('#bootstrap').onclick=async()=>{try{const r=await server('bootstrap');show('#bootstrapMsg',r.message)}catch(e){show('#bootstrapMsg',e.message)}};
$('#loadUsers').onclick=async()=>{show('#usersList','Загрузка…');try{const r=await server('adminList');const target=$('#usersList');target.replaceChildren();for(const p of r.profiles){
 const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=`${p.nickname} (${p.login}) — ${p.approved?'Подтверждён':'Ожидает'}`;
 const btn=document.createElement('button');btn.className='secondary';btn.textContent=p.approved?'Отозвать допуск':'Одобрить';btn.onclick=async()=>{btn.disabled=true;try{await server('approve',{userId:p.id,approved:!p.approved});$('#loadUsers').click()}catch(e){alert(e.message);btn.disabled=false}};
 row.append(label,btn);target.append(row)
 }}catch(e){show('#usersList',e.message)}};
function updateMode(){const chosen=$('#rewardMode').value==='chosen';$('#chooseCardWrap').classList.toggle('hidden',!chosen);$('#rewardCategory').disabled=chosen;$('#rewardRarity').disabled=chosen}
$('#rewardMode').onchange=updateMode;updateMode();
fetch('cards.json').then(r=>r.json()).then(cards=>{const sel=$('#chooseCard');for(const c of cards){const opt=document.createElement('option');opt.value=c.id;opt.textContent=`${c.name} (${c.type})`;sel.append(opt)}});
$('#generateForm').onsubmit=async e=>{e.preventDefault();show('#generateMessage','Создаём коды…');show('#generatedCodes','');try{
 const r=await server('generate',{mode:$('#rewardMode').value,cardId:$('#chooseCard').value,category:$('#rewardCategory').value,rarity:$('#rewardRarity').value,count:Number($('#rewardCount').value),amount:Number($('#rewardAmount').value),reason:$('#rewardReason').value});
 show('#generateMessage',`Создано кодов: ${r.codes.length}. Скопируй их сейчас: повторно увидеть полные коды будет нельзя.`);show('#generatedCodes',r.codes.join('\n'));
 }catch(ex){show('#generateMessage',ex.message)}};
