const $ = id => document.getElementById(id);
const auth = $("authScreen"), app = $("app"), people = $("peopleList"), messages = $("messages");
let registering = false, me = null, peer = 0, users = [], ws = null;
let online = new Set(), typingHide = null, toastHide = null, unread = new Set();

const drafts = new Map();
let historyVersion = 0, pendingHistory = null, oldest = null, reconnectTimer;
let rosterReady = false, legacyMode = false, importing = false;
const sending = new Map();
const quotes = new Map();
let searchRun=null;

function rememberQuote(id,quote){
  if(quote)quotes.set(id,quote);else quotes.delete(id);
  try {
    if(quotes.size)sessionStorage.setItem(draftKey()+".quotes",JSON.stringify([...quotes]));
    else sessionStorage.removeItem(draftKey()+".quotes");
  } catch {}
  showQuote();
}
function showQuote(){
  const q=quotes.get(peer);
  $("replyPreview").hidden=!q;
  $("replyTo").textContent=q?"@"+q.name+" xabariga matnli javob":"";
  $("replyText").textContent=q?.text||"";
}
function splitQuote(body){
  const match=/^> (@[a-z][a-z0-9_]{2,23} · [^\n]+)\n([\s\S]+)$/.exec(body||"");
  return match?{header:match[1],text:match[2]}:{text:body||""};
}
function quoteMessage(m){
  const text=(m.body==="[voice]"?"Ovozli xabar":splitQuote(m.body).text||"Rasm").replace(/\s+/g," ").trim();
  const chars=Array.from(text);
  rememberQuote(peer,{name:m.username,text:chars.length>100?chars.slice(0,99).join("")+"…":text});
  $("messageInput").focus();
}
$("replyCancel").onclick=()=>{rememberQuote(peer,null);$("messageInput").focus();};

const normaliseSearch=value=>value.normalize("NFKC").toLowerCase().replace(/[’‘ʻʼ`]/g,"'");
function stopSearch(){
  searchRun?.controller.abort();
  searchRun=null;
}
function clearSearch(){
  stopSearch();
  $("findResults").replaceChildren();$("findStatus").textContent="";
  $("findMore").hidden=true;
}
$("findOpen").onclick=()=>{
  clearSearch();$("findQuery").value="";
  $("findTitle").textContent=$("chatName").textContent+" · Xabar qidirish";
  $("findDialog").showModal();$("findQuery").focus();
};
$("findClose").onclick=()=>$("findDialog").close();
$("findDialog").addEventListener("close",clearSearch);
$("findQuery").oninput=clearSearch;
function appendResult(m){
  const row=document.createElement("article");row.dataset.id=m.id;
  const author=document.createElement("strong");author.textContent="@"+m.username;
  const stamp=document.createElement("small");stamp.textContent=new Date(m.sent).toLocaleString("uz-UZ");
  const body=document.createElement("p");body.textContent=m.body;
  const reply=document.createElement("button");reply.type="button";reply.className="archive-button";reply.textContent="Iqtibos bilan javob";
  reply.onclick=()=>{$("findDialog").close();quoteMessage(m);};
  row.append(author,stamp,body,reply);$("findResults").append(row);
}
async function searchPages(run){
  if(!run || run.busy)return;
  run.busy=true;$("findMore").hidden=true;$("findStatus").textContent="Izlanmoqda…";
  try{
    let added=0;
    for(let page=0;page<4 && added<20;page++){
      const url="/api/messages?peer="+run.room+(run.before?"&before="+run.before:"");
      const rows=await api(url,{signal:run.controller.signal});
      if(searchRun!==run || peer!==run.room)return;
      for(const m of rows.slice().reverse()){
        if(!run.deleted.has(m.id) && m.body && m.body!=="[voice]" && normaliseSearch(m.body).includes(run.term)){
          appendResult(m);added++;
        }
      }
      run.before=rows[0]?.id;run.more=rows.length===150;
      if(!run.more)break;
    }
    const count=$("findResults").childElementCount;
    $("findStatus").textContent=count?count+" ta xabar topildi.":(run.more?"Tekshirilgan xabarlarda topilmadi.":"Bu suhbatda mos xabar topilmadi.");
  }catch(e){
    if(searchRun!==run)return;
    $("findStatus").textContent="Qidiruv to‘xtadi. Ulanishni tekshirib, yana urining.";
    run.more=true;
  }finally{
    if(searchRun===run){run.busy=false;$("findMore").hidden=!run.more;}
  }
}
$("findForm").onsubmit=e=>{
  e.preventDefault();clearSearch();
  const term=normaliseSearch($("findQuery").value.trim());if(!term)return;
  searchRun={room:peer,term,before:null,controller:new AbortController(),deleted:new Set(),busy:false,more:true};
  searchPages(searchRun);
};
$("findMore").onclick=()=>searchPages(searchRun);
let newMessages = 0, historyFallback, reconnectAttempts = 0;

function draftKey(){ return "sinfchat.drafts."+me.id; }
function saveDraft(id, value){
  if(value) drafts.set(id,value); else drafts.delete(id);
  try {
    if(drafts.size) sessionStorage.setItem(draftKey(), JSON.stringify([...drafts]));
    else sessionStorage.removeItem(draftKey());
  } catch {}
}
function updateComposer(){
  refreshPhotoControls();
  refreshVoiceControls();
  const pending=sending.has(peer);
  $("sendBtn").disabled=pending || !rosterReady || !$("messageInput").value.trim();
  $("sendBtn").setAttribute("aria-label",pending?"Yuborilmoqda":"Yuborish");
  $("sendBtn").textContent=pending?"…":"➤";
}
function finishSend(d){
  const entry=sending.get(d.room);
  if(!entry || entry.tag!==d.tag)return;
  sending.delete(d.room);
  if(d.type==="saved" && entry.quote && quotes.get(d.room)===entry.quote)rememberQuote(d.room,null);
  if(d.type==="saved" && drafts.get(d.room)===entry.value){
    saveDraft(d.room,"");
    if(peer===d.room)$("messageInput").value="";
  }
  updateComposer();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: options.body instanceof FormData ? {...(options.headers||{})} : {"Content-Type":"application/json",...(options.headers||{})}
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.detail === "string" ? json.detail : "Xatolik yuz berdi");
  return json;
}

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message; el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastHide); toastHide = setTimeout(() => el.className = "toast", 3500);
}

function authMode(enabled) {
  registering = enabled;
  legacyMode=false;
  $("legacyHint").hidden=true;
  $("authHeading").textContent=enabled?"Yangi akkaunt":"Akkauntga kirish";
  $("loginTab").classList.toggle("active", !enabled);
  $("registerTab").classList.toggle("active", enabled);
  $("registerFields").classList.toggle("hidden", !enabled);
  $("authSubmit").textContent = enabled ? "Akkaunt yaratish" : "Kirish";
  $("authPass").setAttribute("autocomplete",enabled?"new-password":"current-password");
  $("authError").textContent="";
}
$("loginTab").onclick=()=>authMode(false);
$("registerTab").onclick=()=>authMode(true);

$("legacyLogin").onclick=()=>{
  authMode(false);
  legacyMode=true;
  $("authHeading").textContent="Eski akkaunt bilan kirish";
  $("legacyHint").hidden=false;
  $("authSubmit").textContent="Tasdiqlash va kirish";
  $("authUser").focus();
};

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("authError").textContent="";
  const payload={
    username:$("authUser").value.trim(),
    password:$("authPass").value,
    invite_code:$("invite").value,
    admin_code:$("adminCode").value
  };
  const submitLabel=$("authSubmit").textContent;
  $("authSubmit").disabled = true;
  $("authSubmit").textContent=legacyMode?"Eski server tekshirilmoqda…":"Kutilmoqda…";
  try {
    const recovering=legacyMode;
    await api(recovering?"/api/legacy/link":registering?"/api/register":"/api/login",{method:"POST",body:JSON.stringify(payload)});
    $("authPass").value = ""; $("invite").value = ""; $("adminCode").value = "";
    await initialize();
    if(recovering)await showArchive(true);
  } catch(err) { $("authError").textContent=err.message; }
  finally{$("authSubmit").disabled=false;$("authSubmit").textContent=submitLabel;}
});

async function initialize(){
  me=await api("/api/me");
  peer=0;reconnectAttempts=0;
  drafts.clear();
  try {
    for(const [id,value] of JSON.parse(sessionStorage.getItem(draftKey()) || "[]"))
      if(Number.isInteger(id) && typeof value==="string")drafts.set(id,value);
  } catch {}
  quotes.clear();
  try {
    for(const [id,q] of JSON.parse(sessionStorage.getItem(draftKey()+".quotes")||"[]"))
      if(Number.isInteger(id) && typeof q?.name==="string" && typeof q?.text==="string")quotes.set(id,q);
  } catch {}
  showQuote();
  $("messageInput").value=drafts.get(0)||"";
  updateComposer();
  auth.classList.add("hidden"); app.classList.remove("hidden");
  $("myName").textContent="@"+me.username;
  $("myAvatar").textContent=me.username[0].toUpperCase();
  $("adminBtn").hidden=!me.admin;
  await refreshPeople();
  app.classList.add("chat-open");
  historyFallback=setTimeout(()=>{if(me && !rosterReady)choose(peer,false);},3500);
  openSocket();
}
async function refreshPeople(){
  try{
    users=await api("/api/users");

    $("memberCount").textContent=users.length;
    renderPeople();
  }catch(e){toast(e.message,true);}
}
function rememberUser(id, username){
  if(id !== me.id && username && !users.some(u => u.id === id)){
    users.push({id, username});
    users.sort((a,b) => a.username.localeCompare(b.username));
  }
}
function renderPeople(){
  $("memberCount").textContent=users.length;
  showConnectionState();
  $("onlineList").replaceChildren();
  const present=[me,...users].filter(u=>u && online.has(u.id));
  for(const u of present){
    const item=document.createElement("li");
    item.textContent="@"+u.username+(u.id===me.id?" (siz)":"");
    $("onlineList").append(item);
  }
  if(!rosterReady)$("onlineList").textContent="Ulanish kutilmoqda…";
  $("onlineTitle").textContent=rosterReady?"Hozir onlayn · "+online.size:"Hozir onlayn";
  if(peer)$("chatStatus").textContent=online.has(peer)?"Hozir onlayn":"Shaxsiy suhbat";
  people.replaceChildren();
  const q=$("searchInput").value.trim().replace(/^@/,"").toLowerCase();
  const matches=users.filter(x=>x.username.includes(q));
  if(!matches.length){
    const hint=document.createElement("p");hint.className="people-empty";
    hint.textContent=q?"Bu nom bilan sinfdosh topilmadi.":"Sinfdoshlaringiz qo‘shilganda shu yerda ko‘rinadi.";
    people.append(hint);
  }
  for (const u of matches){
    const item=document.createElement("button");item.className="conversation person"+(peer===u.id?" selected":"");
    const avatar=document.createElement("span");avatar.className="avatar";avatar.textContent=u.username[0].toUpperCase();
    avatar.classList.add("tint-"+u.id%3);
    const texts=document.createElement("span");texts.className="conv-text";
    const strong=document.createElement("strong");strong.textContent="@"+u.username+(unread.has(u.id)?" •":"");
    const desc=document.createElement("span");desc.textContent=online.has(u.id)?"Hozir onlayn":"Shaxsiy chat";
    texts.append(strong,desc);
    const presence=document.createElement("span");presence.className="presence"+(online.has(u.id)?" online":"");
    item.append(avatar,texts,presence); item.onclick=()=>choose(u.id); people.append(item);
  }
}
$("showOnline").onclick=()=>$("onlineDialog").showModal();
$("closeOnline").onclick=()=>$("onlineDialog").close();
$("searchInput").oninput=renderPeople;
$("groupBtn").onclick=()=>choose(0);
$("backBtn").onclick=()=>app.classList.remove("chat-open");

async function choose(id, openChat=true){
  if(id!==peer){
    if($("findDialog").open)$("findDialog").close();
    drafts.set(peer,$("messageInput").value);
    $("messageInput").value=drafts.get(id)||"";
  }
  peer=id; unread.delete(id);showQuote();
  newMessages=0; $("jumpLatest").hidden=true; updateComposer();
  $("groupUnread").textContent=unread.has(0)?"●":"";
  if(openChat)app.classList.add("chat-open");
  $("groupBtn").classList.toggle("selected",id===0);
  const u=users.find(x=>x.id===id);
  $("chatName").textContent=id?"@"+(u?.username||"Foydalanuvchi"):"Bizning sinf";
  $("chatAvatar").textContent=id?(u?.username[0].toUpperCase()||"?"):"#";
  $("chatStatus").textContent=id?(online.has(id)?"Hozir onlayn":"Shaxsiy suhbat"):"Barcha sinfdoshlar guruhi";
  $("typing").textContent="";
  renderPeople();
  messages.replaceChildren();
  const loader=document.createElement("div");loader.className="empty";loader.textContent="Xabarlar yuklanmoqda...";
  messages.append(loader);
  const version=++historyVersion;
  const buffered=[];
  pendingHistory=buffered;
  oldest=null;
  $("older").hidden=true;
  $("older").disabled=false;
  try{
    const data=await api("/api/messages?peer="+id);
    if(version!==historyVersion)return;
    messages.replaceChildren();
    if(!data.length){
      const empty=document.createElement("div");empty.className="empty";
      empty.textContent=id?"Salom deb suhbatni boshlang ✨":"SinfChatga xush kelibsiz! Birinchi bo‘lib salom yozing 👋";
      messages.append(empty);
    }else data.forEach(m=>addMessage(m,false));
    oldest=data[0]?.id;
    $("older").hidden=data.length<150;
    scrollBottom();
  }catch(e){
    if(version!==historyVersion)return;
    loader.textContent="Suhbat tarixini yuklab bo‘lmadi. ";
    const retry=document.createElement("button");
    retry.className="archive-button"; retry.textContent="Qayta yuklash";
    retry.onclick=()=>choose(id,false);
    loader.append(retry); loader.classList.replace("empty","history-error");
  }
  finally{
    if(version===historyVersion){
      pendingHistory=null;
      buffered.forEach(applyEvent);
    }
  }
}
$("older").onclick=async()=>{
  if(!oldest)return;
  const version=historyVersion;
  $("older").disabled=true;
  try{
    const data=await api("/api/messages?peer="+peer+"&before="+oldest);
    if(version!==historyVersion)return;
    const height=messages.scrollHeight, top=messages.scrollTop;
    const fragment=document.createDocumentFragment();
    data.forEach(m=>addMessage(m,false,fragment));
    messages.prepend(fragment);
    messages.scrollTop=top+messages.scrollHeight-height;
    oldest=data[0]?.id;
    $("older").hidden=data.length<150;
  }catch(e){if(version===historyVersion)toast(e.message,true);}
  finally{if(version===historyVersion)$("older").disabled=false;}
};
function applyEvent(event){
  if(event.type==="deleted")messages.querySelector('[data-id="'+event.id+'"]')?.remove();
  else addMessage(event);
}
function nearBottom(){return messages.scrollHeight-messages.clientHeight-messages.scrollTop<64;}
function scrollBottom(){requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight;});}
messages.addEventListener("scroll",()=>{
  if(nearBottom()){newMessages=0;$("jumpLatest").hidden=true;}
});
$("jumpLatest").onclick=scrollBottom;
function addMessage(m, scroll=true, target=messages){
  if(voiceDraft?.mediaId && m.media_id===voiceDraft.mediaId && m.sender===me.id)closeVoice();
  if(photoDraft?.mediaId && m.media_id===photoDraft.mediaId && m.sender===me.id)closePhotoDraft();
  if(messages.querySelector('[data-id="'+m.id+'"]'))return;
  const follow=scroll && (m.sender===me.id || nearBottom());
  const intro=messages.querySelector(".empty");
  if(intro) intro.remove();
  const row=document.createElement("div");row.className="bubble-row"+(m.sender===me.id?" mine":"");row.dataset.id=m.id;
  const bubble=document.createElement("div");bubble.className="bubble";
  if(m.sender!==me.id){
    const sender=document.createElement("div");sender.className="sender";sender.textContent=m.username;bubble.append(sender);
  }
  if(m.body && m.body!=="[voice]"){
    const parts=splitQuote(m.body);
    if(parts.header){
      const quote=document.createElement("blockquote");quote.textContent=parts.header;bubble.append(quote);
    }
    const p=document.createElement("p");p.textContent=parts.text;bubble.append(p);
  }
  if(m.media_id){
    if(m.body==="[voice]"){
      const player=document.createElement("audio");player.controls=true;player.preload="none";player.src="/media/"+m.media_id;bubble.append(player);
    }else{
      bubble.append(photoThumbnail(m.media_id,m.body,m.username,m.id));
    }
  }
  const meta=document.createElement("div");meta.className="bubble-meta";
  const time=document.createElement("span");
  time.title=new Date(m.sent).toLocaleString("uz-UZ");
  const today=new Date().toDateString()===new Date(m.sent).toDateString();
  time.textContent=(today?"":new Date(m.sent).toLocaleDateString("uz-UZ",{day:"numeric",month:"short"})+" · ")+new Date(m.sent).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"});
  const reply=document.createElement("button");reply.type="button";reply.textContent="Javob";
  reply.onclick=()=>quoteMessage(m);
  meta.append(time,reply);
  const action=document.createElement("button");
  action.textContent=m.sender===me.id?"O‘chirish":"Shikoyat";
  action.onclick=()=>m.sender===me.id?deleteMessage(m.id):reportMessage(m.id);
  meta.append(action);bubble.append(meta);row.append(bubble);
  // Parallel sends may arrive in a different order from their stored IDs.
  let next=null;
  if(target===messages && scroll){
    let previous=target.lastElementChild;
    while(previous?.dataset.id && Number(previous.dataset.id)>m.id){
      next=previous;previous=previous.previousElementSibling;
    }
  }
  target.insertBefore(row,next);
  if(follow)scrollBottom();
  else if(scroll){
    $("jumpLatest").textContent="Yangi xabarlar · "+(++newMessages)+" ↓";
    $("jumpLatest").hidden=false;
  }
}
function deleteMessage(id){
  if(confirm("Ushbu xabar hammadan o‘chirilsinmi?")) sendWS({type:"delete",id});
}
async function reportMessage(id){
  const reason=prompt("Shikoyat sababi (3-120 belgi):","Nomaqbul xabar");
  if(!reason)return;
  try{await api("/api/report",{method:"POST",body:JSON.stringify({message_id:id,reason})});toast("Shikoyat adminga yuborildi");}
  catch(e){toast(e.message,true);}
}
function sendWS(message){
  if(!ws || ws.readyState!==WebSocket.OPEN){toast("Serverga ulanish kutilmoqda...",true);return false;}
  ws.send(JSON.stringify(message));return true;
}
function showConnectionState(){
  const offline=navigator.onLine===false;
  $("connectionNote").hidden=rosterReady;
  $("connectionNote").textContent=offline?"Internet uzildi. Qoralamangiz shu oynada saqlanadi.":"Chatga ulanilmoqda…";
  $("showOnline").textContent=rosterReady?online.size+" onlayn":(offline?"Oflayn":"Ulanmoqda…");
}
function disconnected(){
  rosterReady=false;online.clear();renderPeople();
  if(sending.size)toast("Yuborish tasdiqlanmadi. Qayta yuborishdan oldin tarixni tekshiring.",true);
  sending.clear();updateComposer();
}
function resumeConnection(){
  if(!me || navigator.onLine===false || ws?.readyState===WebSocket.OPEN || ws?.readyState===WebSocket.CONNECTING)return;
  openSocket();
}
window.addEventListener("offline",()=>{
  if(!me)return;
  clearTimeout(reconnectTimer);
  const socket=ws;ws=null;
  disconnected();socket?.close();
});
window.addEventListener("online",resumeConnection);
window.addEventListener("pageshow",resumeConnection);
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden)resumeConnection();
});
function openSocket(){
  clearTimeout(reconnectTimer);
  showConnectionState();
  if(navigator.onLine===false)return;
  if(ws) ws.close();
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(protocol+"//"+location.host+"/ws");
  const socket=ws;
  ws.addEventListener("open",()=>{
    if(ws!==socket || !me)return;
    $("chatStatus").textContent="Ulanmoqda…";
  });
  ws.addEventListener("message", e=>{
    if(ws!==socket || !me)return;
    let d;try{d=JSON.parse(e.data)}catch{return;}
    if(photoReceipt(d) || voiceReceipt(d))return;
    if(d.type==="saved"){finishSend(d);return;}
    if(d.type==="error"){finishSend(d);toast(d.message,true);return;}
    if(d.type==="online"){
      clearTimeout(historyFallback);
      rosterReady=true;reconnectAttempts=0;
      online=new Set(d.users);
      (d.members||[]).forEach(u=>rememberUser(u.id,u.username));
      renderPeople();
      updateComposer();
      choose(peer,false);
      return;
    }
    if(d.type==="presence"){
      if(d.online){rememberUser(d.user,d.username);online.add(d.user);}else online.delete(d.user);
      renderPeople();
      if(peer===d.user)$("chatStatus").textContent=d.online?"Hozir onlayn":"Shaxsiy suhbat";
      return;
    }
    if(d.type==="typing"){
      if((peer===0 && !d.recipient)||(peer>0 && d.user===peer && d.recipient===me.id)){
        $("typing").textContent=d.username+" yozmoqda...";
        clearTimeout(typingHide);typingHide=setTimeout(()=>$("typing").textContent="",1700);
      }
      return;
    }
    if(d.type==="deleted"){
      if(viewedMessage===d.id)$("pictureViewer").close();
      if(searchRun){
        searchRun.deleted.add(d.id);
        const result=$("findResults").querySelector('[data-id="'+d.id+'"]');
        if(result){
          result.remove();
          if(!searchRun.busy)$("findStatus").textContent=$("findResults").childElementCount+" ta xabar topildi.";
        }
      }
      if(pendingHistory)pendingHistory.push(d);else applyEvent(d);
      return;
    }
    if(d.type==="message"){
      const thisConversation=peer===0 ? d.recipient===null : ((d.sender===peer&&d.recipient===me.id)||(d.sender===me.id&&d.recipient===peer));
      if(thisConversation){if(pendingHistory)pendingHistory.push(d);else applyEvent(d);}
      else if(d.sender!==me.id){unread.add(d.recipient===null?0:d.sender);renderPeople();$("groupUnread").textContent=unread.has(0)?"●":"";toast("Yangi xabar: @"+d.username);}
    }
  });
  ws.addEventListener("close",()=>{
    if(ws!==socket || !me)return;
    ws=null;disconnected();
    clearTimeout(reconnectTimer);
    if(navigator.onLine!==false){
      const delay=Math.min(15000,600*2**Math.min(reconnectAttempts++,5));
      reconnectTimer=setTimeout(resumeConnection,delay+Math.random()*400);
    }
  });
}
$("messageForm").addEventListener("submit", e=>{
  e.preventDefault();
  const body=$("messageInput").value.trim();
  if(!body || sending.has(peer))return;
  const tag=crypto.randomUUID();
  const value=$("messageInput").value;
  saveDraft(peer,value);
  const quote=quotes.get(peer);
  const content=quote?"> @"+quote.name+" · "+quote.text+"\n"+body:body;
  if(Array.from(content).length>2000){toast("Iqtibos bilan birga xabar 2000 belgidan oshdi.",true);return;}
  if(sendWS({type:"message",recipient:peer||null,body:content,tag})){
    sending.set(peer,{tag,value,quote});
    updateComposer();
  }
});
let lastTyping=0;
$("messageInput").addEventListener("input",()=>{
  saveDraft(peer,$("messageInput").value);updateComposer();
  if(rosterReady && Date.now()-lastTyping>850){sendWS({type:"typing",recipient:peer||null});lastTyping=Date.now();}
});
async function uploadMediaOnce(draft,name,signal){
  if(draft.mediaId)return;
  const form=new FormData();
  form.append("file",draft.blob,name);
  const result=await api("/api/media",{method:"POST",body:form,signal});
  draft.mediaId=result.media_id;
}
setupPhotoTools();
setupVoiceTools();
$("logoutBtn").onclick=async()=>{
  try{await api("/api/logout",{method:"POST",body:"{}"});}catch(e){toast("Chiqish amalga oshmadi. Qayta urining.",true);return;}
  closePhotoDraft();$("pictureViewer").close();
  clearSearch();$("findDialog").close();quotes.clear();showQuote();
  try{sessionStorage.removeItem(draftKey());sessionStorage.removeItem(draftKey()+".quotes");}catch{}
  closeVoice();
  if(ws){ws.onclose=null;ws.close();ws=null;}
  clearTimeout(reconnectTimer);
  clearTimeout(historyFallback);
  historyVersion++;pendingHistory=null;
  online.clear();unread.clear();drafts.clear();users=[];rosterReady=false;sending.clear();
  $("archiveDialog").close();$("archiveContent").replaceChildren();$("archivePass").value="";$("messageInput").value="";
  $("onlineDialog").close();
  $("searchInput").value=""; $("messages").replaceChildren(); $("adminDialog").close();
  me=null;app.classList.add("hidden");auth.classList.remove("hidden");app.classList.remove("chat-open");authMode(false);
};
$("adminBtn").onclick=async()=>{
  $("adminDialog").showModal();
  const content=$("adminContent");content.textContent="Yuklanmoqda...";
  try{
    const reports=await api("/api/admin/reports");
    content.replaceChildren();
    if(!reports.length)content.textContent="Hozircha shikoyatlar yo‘q.";
    reports.forEach(r=>{
      const item=document.createElement("div");item.className="admin-item";
      item.textContent="Xabar #"+r.message_id+": "+r.reason+" (yuborgan #"+r.reporter+")";content.append(item);
    });
    const heading=document.createElement("h4");heading.textContent="Foydalanuvchilar";content.append(heading);
    users.forEach(u=>{
      const item=document.createElement("div");item.className="admin-item";item.textContent="@"+u.username;
      const b=document.createElement("button");b.textContent="Bloklash";
      b.onclick=async()=>{
        if(!confirm("@"+u.username+" akkauntini cheklaysizmi?"))return;
        try{await api("/api/admin/ban",{method:"POST",body:JSON.stringify({user_id:u.id,banned:true})});toast("Akkaunt bloklandi");await refreshPeople();item.remove();}
        catch(e){toast(e.message,true);}
      };
      item.append(b);content.append(item);
    });
  }catch(e){content.textContent=e.message;}
};
$("closeAdmin").onclick=()=>$("adminDialog").close();
initialize().catch(()=>{});

const archiveStatus = text => { $("archiveState").textContent=text; };
async function showArchive(importNow=false){
  $("archiveContent").replaceChildren();
  $("archiveChats").replaceChildren();
  $("archivePass").value="";
  $("archiveLink").hidden=true;
  if(!$("archiveDialog").open)$("archiveDialog").showModal();
  if(importing)return;
  archiveStatus("");
  try{
    await listArchive();
    if(importNow)await importArchive();
  }catch(e){archiveStatus(e.message);}
}
async function listArchive(){
  const chats=await api("/api/archive");
  $("archiveChats").replaceChildren();
  if(!chats.length){
    $("archiveChats").textContent="Hozircha arxiv bo‘sh.";
    return;
  }
  for(const room of chats){
    const button=document.createElement("button");
    button.className="archive-room";
    button.textContent=(room.chat==="Guruh"?"Sinf guruhi":"@"+room.chat)+" · "+room.total+" xabar";
    button.onclick=async()=>{
      try{
        const rows=await api("/api/archive?chat="+encodeURIComponent(room.chat));
        const content=$("archiveContent");content.replaceChildren();
        const title=document.createElement("h3");title.textContent=room.chat;content.append(title);
        for(const m of rows){
          const row=document.createElement("article");
          const by=document.createElement("strong");
          by.textContent="@"+m.author+" · "+new Date(m.sent).toLocaleString("uz-UZ");
          row.append(by);
          if(m.body && m.body!=="[voice]"){
            const p=document.createElement("p");p.textContent=m.body;row.append(p);
          }
          if(m.media_id){
            if(m.body==="[voice]"){
              const file=document.createElement("audio");file.controls=true;file.preload="none";file.src="/media/"+m.media_id;row.append(file);
            }else row.append(photoThumbnail(m.media_id,m.body,m.author));
          }else if(m.attachment){row.append(document.createTextNode("Fayl eski serverda mavjud emas."));}
          content.append(row);
        }
        title.scrollIntoView({block:"nearest"});
      }catch(e){archiveStatus(e.message);}
    };
    $("archiveChats").append(button);
  }
}
async function importArchive(){
  if(importing)return;
  importing=true;
  const owner=me?.id;
  const active=()=>me?.id===owner && $("archiveDialog").open;
  $("archiveImport").disabled=true;
  try{
    let rooms;
    try{rooms=await api("/api/legacy/sources");}
    catch(e){$("archiveLink").hidden=false;throw e;}
    $("archiveLink").hidden=true;
    let missing=0;
    for(const [index,room] of rooms.entries()){
      let after=0;
      do{
        if(!active())return;
        archiveStatus("Ko‘chirilmoqda · "+(index+1)+"/"+rooms.length+" · "+room.name);
        const page=await api("/api/legacy/import?peer="+room.id+"&after="+after,{method:"POST"});
        missing+=page.missing;
        if(!page.more)break;
        after=page.after;
      }while(true);
    }
    if(active()){
      archiveStatus("Mavjud suhbatlar arxivga saqlandi."+(missing?" Topilmagan fayllar: "+missing+".":""));
      await listArchive();
    }
  }catch(e){if(active())archiveStatus(e.message);}
  finally{importing=false;$("archiveImport").disabled=false;}
}
$("openArchive").onclick=()=>showArchive();
$("archiveImport").onclick=importArchive;
$("archiveClose").onclick=()=>$("archiveDialog").close();
$("archiveLink").onsubmit=async e=>{
  e.preventDefault();
  const password=$("archivePass").value;
  $("archivePass").value="";
  try{
    await api("/api/legacy/link",{method:"POST",body:JSON.stringify({username:me.username,password})});
    await importArchive();
  }catch(err){archiveStatus(err.message);}
};
