const $ = id => document.getElementById(id);
const auth = $("authScreen"), app = $("app"), people = $("peopleList"), messages = $("messages");
let registering = false, me = null, peer = 0, users = [], ws = null, recorder = null, chunks = [];
let online = new Set(), typingHide = null, toastHide = null, unread = new Set();

const drafts = new Map();
let historyVersion = 0, pendingHistory = null, oldest = null, reconnectTimer;
let rosterReady = false, legacyMode = false, importing = false;

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
  auth.classList.add("hidden"); app.classList.remove("hidden");
  $("myName").textContent="@"+me.username;
  $("myAvatar").textContent=me.username[0].toUpperCase();
  $("adminBtn").hidden=!me.admin;
  await refreshPeople();
  choose(0);
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
  $("showOnline").textContent=rosterReady ? online.size+" onlayn" : "Ulanmoqda…";
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
  for (const u of users.filter(x=>x.username.includes(q))){
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

async function choose(id){
  if(id!==peer){
    drafts.set(peer,$("messageInput").value);
    $("messageInput").value=drafts.get(id)||"";
  }
  peer=id; unread.delete(id);
  $("groupUnread").textContent=unread.has(0)?"●":"";
  app.classList.add("chat-open");
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
  }catch(e){if(version===historyVersion)toast(e.message,true);}
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
function scrollBottom(){requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight);}
function addMessage(m, scroll=true, target=messages){
  if(messages.querySelector('[data-id="'+m.id+'"]'))return;
  const intro=messages.querySelector(".empty");
  if(intro) intro.remove();
  const row=document.createElement("div");row.className="bubble-row"+(m.sender===me.id?" mine":"");row.dataset.id=m.id;
  const bubble=document.createElement("div");bubble.className="bubble";
  if(m.sender!==me.id){
    const sender=document.createElement("div");sender.className="sender";sender.textContent=m.username;bubble.append(sender);
  }
  if(m.body && m.body!=="[voice]"){
    const p=document.createElement("p");p.textContent=m.body;bubble.append(p);
  }
  if(m.media_id){
    if(m.body==="[voice]"){
      const player=document.createElement("audio");player.controls=true;player.preload="none";player.src="/media/"+m.media_id;bubble.append(player);
    }else{
      const picture=document.createElement("img");picture.src="/media/"+m.media_id;picture.alt="Yuborilgan rasm";picture.loading="lazy";bubble.append(picture);
    }
  }
  const meta=document.createElement("div");meta.className="bubble-meta";
  const time=document.createElement("span");
  time.title=new Date(m.sent).toLocaleString("uz-UZ");
  const today=new Date().toDateString()===new Date(m.sent).toDateString();
  time.textContent=(today?"":new Date(m.sent).toLocaleDateString("uz-UZ",{day:"numeric",month:"short"})+" · ")+new Date(m.sent).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"});
  meta.append(time);
  const action=document.createElement("button");
  action.textContent=m.sender===me.id?"O‘chirish":"Shikoyat";
  action.onclick=()=>m.sender===me.id?deleteMessage(m.id):reportMessage(m.id);
  meta.append(action);bubble.append(meta);row.append(bubble);target.append(row);if(scroll)scrollBottom();
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
function openSocket(){
  clearTimeout(reconnectTimer);
  if(ws) ws.close();
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(protocol+"//"+location.host+"/ws");
  const socket=ws;
  ws.addEventListener("open",()=>{toast("Chatga ulandingiz");});
  ws.addEventListener("message", e=>{
    if(ws!==socket || !me)return;
    let d;try{d=JSON.parse(e.data)}catch{return;}
    if(d.type==="error"){toast(d.message,true);return;}
    if(d.type==="online"){
      rosterReady=true;
      online=new Set(d.users);
      (d.members||[]).forEach(u=>rememberUser(u.id,u.username));
      renderPeople();
      const wasOpen=app.classList.contains("chat-open");
      choose(peer);
      if(!wasOpen)app.classList.remove("chat-open");
      return;
    }
    if(d.type==="presence"){
      if(d.online){rememberUser(d.user,d.username);online.add(d.user);}else online.delete(d.user);
      renderPeople();
      if(peer===d.user)$("chatStatus").textContent=d.online?"Hozir onlayn":"Shaxsiy suhbat";
      return;
    }
    if(d.type==="typing"){
      if((peer===0 && !d.recipient)||(peer>0 && d.user===peer)){
        $("typing").textContent=d.username+" yozmoqda...";
        clearTimeout(typingHide);typingHide=setTimeout(()=>$("typing").textContent="",1700);
      }
      return;
    }
    if(d.type==="deleted"){
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
    rosterReady=false;online.clear();renderPeople();
    $("chatStatus").textContent="Ulanish tiklanmoqda...";
    reconnectTimer=setTimeout(()=>{if(!app.classList.contains("hidden"))openSocket();},2800);
  });
}
$("messageForm").addEventListener("submit", e=>{
  e.preventDefault();
  const body=$("messageInput").value.trim();
  if(!body)return;
  if(sendWS({type:"message",recipient:peer||null,body})){$("messageInput").value="";}
});
let lastTyping=0;
$("messageInput").addEventListener("input",()=>{
  if(Date.now()-lastTyping>850){sendWS({type:"typing",recipient:peer||null});lastTyping=Date.now();}
});
async function uploadAndSend(blob,name,type,voice=false,recipient=peer){
  const owner=me?.id;
  if(blob.size>2*1024*1024){toast("2MB dan kichik fayl yuboring",true);return;}
  const form=new FormData();form.append("file",blob,name);
  try{
    const result=await api("/api/media",{method:"POST",body:form});
    if(me?.id!==owner)return;
    if(!sendWS({type:"message",recipient:recipient||null,body:voice?"[voice]":"",media_id:result.media_id}))toast("Fayl yuborilmadi",true);
  }catch(e){toast(e.message,true);}
}
$("imageInput").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  await uploadAndSend(file,file.name,file.type,false);
  e.target.value="";
});
$("micBtn").onclick=async()=>{
  if(recorder && recorder.state==="recording"){recorder.stop();$("micBtn").textContent="🎙";return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("Brauzeringiz ovoz yozishni qo‘llamaydi",true);return;}
  try{
    const recipient=peer, owner=me.id;
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":(MediaRecorder.isTypeSupported("audio/ogg")?"audio/ogg":"");
    if(!mime){stream.getTracks().forEach(t=>t.stop());toast("Ushbu brauzer audio formatini qo‘llamaydi",true);return;}
    chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());if(me?.id===owner)uploadAndSend(new Blob(chunks,{type:mime}),"voice."+mime.split("/")[1],mime,true,recipient);};
    recorder.start();$("micBtn").textContent="⏹";toast("Ovoz yozilmoqda. Tugatish uchun ⏹ ni bosing.");
  }catch{toast("Mikrofon ruxsati berilmadi",true);}
};
$("logoutBtn").onclick=async()=>{
  try{await api("/api/logout",{method:"POST",body:"{}"});}catch{}
  if(recorder?.state==="recording"){recorder.stop();$("micBtn").textContent="🎙";}
  if(ws){ws.onclose=null;ws.close();ws=null;}
  clearTimeout(reconnectTimer);
  historyVersion++;pendingHistory=null;
  online.clear();unread.clear();drafts.clear();users=[];rosterReady=false;
  $("archiveDialog").close();$("archiveContent").replaceChildren();$("archivePass").value="";$("messageInput").value="";
  $("onlineDialog").close();
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
            const file=document.createElement(m.body==="[voice]"?"audio":"img");
            file.src="/media/"+m.media_id;
            if(file.tagName==="AUDIO"){file.controls=true;file.preload="none";}
            else{file.loading="lazy";file.alt="Arxivdagi rasm";}
            row.append(file);
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
