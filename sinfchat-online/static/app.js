const $ = id => document.getElementById(id);
const auth = $("authScreen"), app = $("app"), people = $("peopleList"), messages = $("messages");
let registering = false, me = null, peer = 0, users = [], ws = null, recorder = null, chunks = [];
let online = new Set(), typingHide = null, toastHide = null, unread = new Set();

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
  $("loginTab").classList.toggle("active", !enabled);
  $("registerTab").classList.toggle("active", enabled);
  $("registerFields").classList.toggle("hidden", !enabled);
  $("authSubmit").textContent = enabled ? "Akkaunt yaratish" : "Kirish";
  $("authPass").setAttribute("autocomplete",enabled?"new-password":"current-password");
  $("authError").textContent="";
}
$("loginTab").onclick=()=>authMode(false);
$("registerTab").onclick=()=>authMode(true);

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("authError").textContent="";
  const payload={
    username:$("authUser").value.trim(),
    password:$("authPass").value,
    invite_code:$("invite").value,
    admin_code:$("adminCode").value
  };
  $("authSubmit").disabled = true;
  try {
    await api(registering?"/api/register":"/api/login",{method:"POST",body:JSON.stringify(payload)});
    $("authPass").value = ""; $("invite").value = ""; $("adminCode").value = "";
    await initialize();
  } catch(err) { $("authError").textContent=err.message; }
  finally{$("authSubmit").disabled=false;}
});

async function initialize(){
  me=await api("/api/me");
  auth.classList.add("hidden"); app.classList.remove("hidden");
  $("myName").textContent="@"+me.username;
  $("myAvatar").textContent=me.username[0].toUpperCase();
  $("adminBtn").hidden=!me.admin;
  await refreshPeople();
  await choose(0);
  openSocket();
}
async function refreshPeople(){
  try{
    users=await api("/api/users");
    users.forEach(u=>{if(u.online)online.add(u.id);else online.delete(u.id);});
    $("memberCount").textContent=users.length;
    renderPeople();
  }catch(e){toast(e.message,true);}
}
function renderPeople(){
  people.replaceChildren();
  const q=$("searchInput").value.toLowerCase();
  for (const u of users.filter(x=>x.username.includes(q))){
    const item=document.createElement("button");item.className="conversation person"+(peer===u.id?" selected":"");
    const avatar=document.createElement("span");avatar.className="avatar";avatar.textContent=u.username[0].toUpperCase();
    avatar.style.background=["linear-gradient(130deg,#377fd9,#976de2)","linear-gradient(135deg,#d9759b,#864eaf)","linear-gradient(135deg,#2d9c94,#4c72c9)"][u.id%3];
    const texts=document.createElement("span");texts.className="conv-text";
    const strong=document.createElement("strong");strong.textContent="@"+u.username+(unread.has(u.id)?" •":"");
    const desc=document.createElement("span");desc.textContent=online.has(u.id)?"Hozir onlayn":"Shaxsiy chat";
    texts.append(strong,desc);
    const presence=document.createElement("span");presence.className="presence"+(online.has(u.id)?" online":"");
    item.append(avatar,texts,presence); item.onclick=()=>choose(u.id); people.append(item);
  }
}
$("searchInput").oninput=renderPeople;
$("groupBtn").onclick=()=>choose(0);
$("backBtn").onclick=()=>app.classList.remove("chat-open");

async function choose(id){
  peer=id; unread.delete(id);
  app.classList.add("chat-open");
  $("groupBtn").classList.toggle("selected",id===0);
  const u=users.find(x=>x.id===id);
  $("chatName").textContent=id?"@"+(u?.username||"Foydalanuvchi"):"Bizning sinf";
  $("chatAvatar").textContent=id?(u?.username[0].toUpperCase()||"?"):"👥";
  $("chatStatus").textContent=id?(online.has(id)?"Hozir onlayn":"Shaxsiy suhbat"):"Barcha sinfdoshlar guruhi";
  $("typing").textContent="";
  renderPeople();
  messages.replaceChildren();
  const loader=document.createElement("div");loader.className="empty";loader.textContent="Xabarlar yuklanmoqda...";
  messages.append(loader);
  const selected=id;
  try{
    const data=await api("/api/messages?peer="+id);
    if(peer!==selected)return;
    messages.replaceChildren();
    if(!data.length){
      const empty=document.createElement("div");empty.className="empty";
      empty.textContent=id?"Salom deb suhbatni boshlang ✨":"SinfChatga xush kelibsiz! Birinchi bo‘lib salom yozing 👋";
      messages.append(empty);
    }else data.forEach(addMessage);
    scrollBottom();
  }catch(e){toast(e.message,true);}
}
function scrollBottom(){requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight);}
function addMessage(m){
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
  time.textContent=new Date(m.sent).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"});
  meta.append(time);
  const action=document.createElement("button");
  action.textContent=m.sender===me.id?"O‘chirish":"Shikoyat";
  action.onclick=()=>m.sender===me.id?deleteMessage(m.id):reportMessage(m.id);
  meta.append(action);bubble.append(meta);row.append(bubble);messages.append(row);scrollBottom();
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
  if(ws) ws.close();
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(protocol+"//"+location.host+"/ws");
  ws.addEventListener("open",()=>{toast("Chatga ulandingiz");});
  ws.addEventListener("message", e=>{
    let d;try{d=JSON.parse(e.data)}catch{return;}
    if(d.type==="error"){toast(d.message,true);return;}
    if(d.type==="online"){online=new Set(d.users);renderPeople();return;}
    if(d.type==="presence"){
      if(d.online)online.add(d.user);else online.delete(d.user);
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
      messages.querySelectorAll(".bubble-row").forEach(row=>{if(Number(row.dataset.id)===d.id)row.remove();});
      return;
    }
    if(d.type==="message"){
      const thisConversation=peer===0 ? d.recipient===null : ((d.sender===peer&&d.recipient===me.id)||(d.sender===me.id&&d.recipient===peer));
      if(thisConversation)addMessage(d);
      else if(d.sender!==me.id){unread.add(d.recipient===null?0:d.sender);renderPeople();$("groupUnread").textContent=unread.has(0)?"●":"";toast("Yangi xabar: @"+d.username);}
    }
  });
  ws.addEventListener("close",()=>{
    if(app.classList.contains("hidden"))return;
    $("chatStatus").textContent="Ulanish tiklanmoqda...";
    setTimeout(()=>{if(!app.classList.contains("hidden"))openSocket();},2800);
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
async function uploadAndSend(blob,name,type,voice=false){
  if(blob.size>2*1024*1024){toast("2MB dan kichik fayl yuboring",true);return;}
  const form=new FormData();form.append("file",blob,name);
  try{
    const result=await api("/api/media",{method:"POST",body:form});
    if(!sendWS({type:"message",recipient:peer||null,body:voice?"[voice]":"",media_id:result.media_id}))toast("Fayl yuborilmadi",true);
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
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":(MediaRecorder.isTypeSupported("audio/ogg")?"audio/ogg":"");
    if(!mime){stream.getTracks().forEach(t=>t.stop());toast("Ushbu brauzer audio formatini qo‘llamaydi",true);return;}
    chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());uploadAndSend(new Blob(chunks,{type:mime}),"voice."+mime.split("/")[1],mime,true);};
    recorder.start();$("micBtn").textContent="⏹";toast("Ovoz yozilmoqda. Tugatish uchun ⏹ ni bosing.");
  }catch{toast("Mikrofon ruxsati berilmadi",true);}
};
$("logoutBtn").onclick=async()=>{
  try{await api("/api/logout",{method:"POST",body:"{}"});}catch{}
  if(ws){ws.onclose=null;ws.close();ws=null;}
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
api("/api/me").then(initialize).catch(()=>{});
