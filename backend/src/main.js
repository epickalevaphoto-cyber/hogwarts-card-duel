import crypto from 'node:crypto';
import cards from './cards.json' with {type:'json'};

// Appwrite Function: configure execute permission = Users (authenticated).
// Function's built-in x-appwrite-key is server-only and must have databases.read/write and users.read.
const ENDPOINT=process.env.APPWRITE_FUNCTION_API_ENDPOINT||process.env.APPWRITE_ENDPOINT||'https://fra.cloud.appwrite.io/v1';
const PROJECT=process.env.APPWRITE_FUNCTION_PROJECT_ID||process.env.APPWRITE_PROJECT_ID||'6ad75c6d0024af9d8bab';
const DB='hogwarts_duel';
const TABLES=['profiles','reward_codes','redemptions'];
const FIELDS={
 profiles:[['nickname','string',120,true],['login','string',120,false],['approved','boolean',null,false,false],['collectionPublic','boolean',null,false,false],['createdAt','string',40,false]],
 reward_codes:[['hash','string',64,true],['mode','string',30,true],['cardId','string',40,false],['category','string',60,false],['rarity','string',30,false],['count','integer',null,true],['newOnly','boolean',null,false,false],['reason','string',500,false],['createdBy','string',36,true],['createdAt','string',40,true],['usedBy','string',36,false],['usedAt','string',40,false]],
 redemptions:[['userId','string',36,true],['cardId','string',40,true],['codeId','string',36,true],['redeemedAt','string',40,true]]
};
const id=()=>crypto.randomBytes(12).toString('hex');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>new Date().toISOString();
const encode=s=>encodeURIComponent(s);
const qs=o=>Object.entries(o).map(([k,v])=>`${encode(k)}=${encode(v)}`).join('&');
const eq=(key,value)=>JSON.stringify({method:'equal',attribute:key,values:[value]});
function failure(msg,status=400){const e=new Error(msg);e.status=status;throw e}
export default async ({req,res,log,error})=>{
 const key=req.headers['x-appwrite-key'];
 const uid=req.headers['x-appwrite-user-id'];
 const admin=!!uid&&uid===process.env.ADMIN_USER_ID;
 const body=typeof req.bodyJson==='object'&&req.bodyJson!==null?req.bodyJson:JSON.parse(req.bodyText||'{}');
 async function api(method,path,data){
  const r=await fetch(ENDPOINT+path,{method,headers:{'X-Appwrite-Project':PROJECT,'X-Appwrite-Key':key,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const v=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(v.message||`Appwrite ${r.status}`);e.status=r.status;throw e}return v;
 }
 const docs=(t,params='')=>api('GET',`/databases/${DB}/collections/${t}/documents${params?'?'+params:''}`);
 const get=(t,doc)=>api('GET',`/databases/${DB}/collections/${t}/documents/${encode(doc)}`);
 const create=(t,doc,data)=>api('POST',`/databases/${DB}/collections/${t}/documents`,{documentId:doc,data,permissions:[]});
 const update=(t,doc,data)=>api('PATCH',`/databases/${DB}/collections/${t}/documents/${encode(doc)}`,{data});
 const list=async(t,filters=[])=>{let result=[],offset=0;do{let q=filters.map((f,i)=>[`queries[${i}]`,f]);q.push(['queries['+filters.length+']',JSON.stringify({method:'limit',values:[100]})]);q.push(['queries['+(filters.length+1)+']',JSON.stringify({method:'offset',values:[offset]})]);let d=await docs(t,new URLSearchParams(q).toString());result.push(...d.documents);if(d.documents.length<100)break;offset+=100;if(offset>=5000)failure('Слишком много записей для одного запроса');}while(true);return result};
 try{
  if(!key)failure('Для функции не настроен серверный ключ Appwrite',503);
  if(!uid)failure('Сначала войдите в аккаунт',401);
  if(body.action==='bootstrap'){
   if(!admin)failure('Только главный администратор',403);
   try{await api('POST','/databases',{databaseId:DB,name:'Hogwarts Duel'})}catch(e){if(e.status!==409)throw e}
   for(const t of TABLES){try{await api('POST',`/databases/${DB}/collections`,{collectionId:t,name:t,permissions:[],documentSecurity:false})}catch(e){if(e.status!==409)throw e}
    for(const [name,type,size,required,defaultValue] of FIELDS[t]){
     const path=`/databases/${DB}/collections/${t}/attributes/${type}`;
     const data={key:name,required,...(type==='string'?{size}:{}),...(defaultValue!==undefined?{default:defaultValue}:{})};
     try{await api('POST',path,data)}catch(e){if(e.status!==409)throw e}
    }
   }
   return res.json({ok:true,message:'Структура базы создана. Подождите 20–40 секунд, пока поля станут доступными.'});
  }
  if(body.action==='me'){
   let profile;try{profile=await get('profiles',uid)}catch(e){if(e.status!==404)throw e;const u=await api('GET',`/users/${uid}`);profile=await create('profiles',uid,{nickname:u.name||'Игрок',login:u.email?.split('@')[0]||'',approved:admin,collectionPublic:false,createdAt:now()})}
   return res.json({ok:true,profile:{id:uid,nickname:profile.nickname,approved:admin||profile.approved,collectionPublic:profile.collectionPublic,admin}});
  }
  if(body.action==='privacy'){
   const p=await get('profiles',uid);await update('profiles',uid,{collectionPublic:!!body.public});return res.json({ok:true});
  }
  if(body.action==='inventory'){
   const mine=await list('redemptions',[eq('userId',uid)]);const counts={};for(const r of mine)counts[r.cardId]=(counts[r.cardId]||0)+1;
   return res.json({ok:true,counts});
  }
  if(body.action==='adminList'){
   if(!admin)failure('Нет прав администратора',403);
   const profiles=await list('profiles');return res.json({ok:true,profiles:profiles.map(p=>({id:p.$id,nickname:p.nickname,login:p.login,approved:p.approved,createdAt:p.createdAt}))});
  }
  if(body.action==='approve'){
   if(!admin)failure('Нет прав администратора',403);
   if(!/^[a-zA-Z0-9_]{1,36}$/.test(body.userId||''))failure('Неверный идентификатор');
   await update('profiles',body.userId,{approved:!!body.approved});return res.json({ok:true});
  }
  if(body.action==='generate'){
   if(!admin)failure('Нет прав администратора',403);
   const mode=body.mode;
   if(!['chosen','random','new'].includes(mode))failure('Неизвестный тип награды');
   if(mode==='chosen'&&!cards.some(c=>String(c.id)===String(body.cardId)))failure('Карта не найдена');
   const amount=Number(body.amount||1),count=Number(body.count||1);
   if(!Number.isInteger(amount)||amount<1||amount>30||!Number.isInteger(count)||count<1||count>10)failure('За раз можно создать до 30 кодов, по 1–10 карт');
   const category=String(body.category||'Все'),rarity=String(body.rarity||'Все');
   if(!['Все','Растения','Существа','Персонажи','Зелья','Заклинания','Навыки'].includes(category))failure('Неверная категория');
   if(!['Все','Обычная','Необычная','Редкая','Эпическая','Легендарная'].includes(rarity))failure('Неверная редкость');
   const codes=[];
   for(let i=0;i<amount;i++){
    const code='HCD-'+crypto.randomBytes(9).toString('hex').toUpperCase();
    await create('reward_codes',id(),{hash:hash(code),mode,cardId:mode==='chosen'?String(body.cardId):'',category,rarity,count,newOnly:mode==='new',reason:String(body.reason||'').slice(0,500),createdBy:uid,createdAt:now(),usedBy:'',usedAt:''});codes.push(code);
   }
   return res.json({ok:true,codes});
  }
  if(body.action==='redeem'){
   const profile=await get('profiles',uid);if(!profile.approved&&!admin)failure('Аккаунт ещё не подтверждён администрацией',403);
   const code=String(body.code||'').trim().toUpperCase();if(!/^HCD-[A-F0-9]{18}$/.test(code))failure('Неверный формат кода');
   const matches=await list('reward_codes',[eq('hash',hash(code))]);const reward=matches[0];if(!reward)failure('Код не найден');
   if(reward.usedBy)failure('Код уже использован');
   const mine=await list('redemptions',[eq('userId',uid)]);const owned=new Set(mine.map(r=>r.cardId));
   let pool=cards.filter(c=>(reward.category==='Все'||c.type===reward.category)&&(reward.rarity==='Все'||(c.rarity||'Обычная')===reward.rarity));
   if(reward.mode==='new')pool=pool.filter(c=>!owned.has(String(c.id)));
   if(reward.mode==='chosen')pool=cards.filter(c=>String(c.id)===reward.cardId);
   if(!pool.length)failure('Нет подходящих карт. Код не потрачен');
   const picks=[];for(let i=0;i<reward.count;i++){
    if(!pool.length)break;
    const index=crypto.randomInt(pool.length),picked=pool[index];picks.push(picked);
    if(reward.mode==='new')pool.splice(index,1);
   }
   // A deterministic redemption id for the first card prevents two simultaneous
   // executions from both granting this code. No client can write these collections.
   const claimId=hash(reward.$id).slice(0,32);
   try{await create('redemptions',claimId,{userId:uid,cardId:String(picks[0].id),codeId:reward.$id,redeemedAt:now()})}catch(e){if(e.status===409)failure('Этот код уже активирован');throw e}
   for(let i=1;i<picks.length;i++)await create('redemptions',id(),{userId:uid,cardId:String(picks[i].id),codeId:reward.$id,redeemedAt:now()});
   await update('reward_codes',reward.$id,{usedBy:uid,usedAt:now()});
   return res.json({ok:true,cards:picks.map(c=>({id:c.id,name:c.name,image:c.image}))});
  }
  failure('Неизвестное действие');
 }catch(e){error(e.stack||e.message);return res.json({ok:false,error:e.message,status:e.status||500},e.status||500)}
};
