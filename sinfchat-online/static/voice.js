let voiceDraft=null;

function refreshVoiceControls(){
  const d=voiceDraft;
  if(!d)return;
  $("voiceClose").disabled=d.busy;
  $("voiceStop").hidden=d.recorder?.state!=="recording";
  $("voiceRedo").hidden=!d.blob && !d.failed;
  $("voiceRedo").disabled=d.busy;
  $("voiceSend").hidden=!d.blob;
  $("voiceSend").disabled=d.busy || !rosterReady;
  $("voiceSend").textContent=d.busy?"Yuborilmoqda…":rosterReady?"Yuborish":"Ulanish kutilmoqda…";
  $("voiceIndicator").classList.toggle("active",d.recorder?.state==="recording");
}
function releaseVoice(d){
  clearInterval(d.clock);
  clearTimeout(d.timeout);
  d.controller?.abort();
  if(d.recorder?.state==="recording")d.recorder.stop();
  d.stream?.getTracks().forEach(track=>track.stop());
  if(d.url)URL.revokeObjectURL(d.url);
}
function closeVoice(){
  const d=voiceDraft;
  if(!d)return;
  voiceDraft=null;
  releaseVoice(d);
  $("voicePreview").pause();$("voicePreview").removeAttribute("src");$("voicePreview").load();
  $("voiceDialog").close();
}
function showVoiceTime(start){
  const t=Math.floor((performance.now()-start)/1000);
  $("voiceTime").textContent=Math.floor(t/60)+":"+String(t%60).padStart(2,"0");
}
async function recordVoice(){
  if(!me || voiceDraft?.busy)return;
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
    toast("Brauzeringizda ovoz yozish imkoni yo‘q.",true);return;
  }
  const format=["audio/webm","audio/ogg"].find(type=>MediaRecorder.isTypeSupported(type));
  if(!format){toast("Brauzeringiz qo‘llaydigan audio formatida yozib bo‘lmadi.",true);return;}
  const previous=voiceDraft;
  const d={owner:me.id,room:previous?.room??peer,busy:false,failed:false};
  voiceDraft=d;
  if(previous)releaseVoice(previous);
  const player=$("voicePreview");
  player.pause();player.removeAttribute("src");player.load();player.hidden=true;
  $("voiceTime").textContent="0:00";
  $("voiceStatus").textContent="Mikrofonga ruxsat kutilmoqda…";
  if(!$("voiceDialog").open){
    $("voiceRoom").textContent="Suhbat · "+$("chatName").textContent;
    $("voiceDialog").showModal();
  }
  refreshVoiceControls();
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(voiceDraft!==d){stream.getTracks().forEach(track=>track.stop());return;}
    d.stream=stream;
    const recorder=new MediaRecorder(stream,{mimeType:format,audioBitsPerSecond:64000});
    d.recorder=recorder;
    const parts=[];
    let size=0;
    recorder.ondataavailable=e=>{
      if(!e.data.size)return;
      parts.push(e.data);size+=e.data.size;
      if(size>=820*1024 && recorder.state==="recording")recorder.stop();
    };
    recorder.onerror=()=>{
      if(voiceDraft!==d)return;
      d.failed=true;releaseVoice(d);
      $("voiceStatus").textContent="Ovoz yozilmadi. Mikrofonni tekshirib, qayta yozing.";
      refreshVoiceControls();
    };
    recorder.onstop=()=>{
      clearInterval(d.clock);
      stream.getTracks().forEach(track=>track.stop());
      if(voiceDraft!==d || d.failed)return;
      showVoiceTime(d.started);
      if(size>0 && size<=2*1024*1024){
        d.blob=new Blob(parts,{type:format});
        d.url=URL.createObjectURL(d.blob);
        player.src=d.url;player.hidden=false;
        $("voiceStatus").textContent="Yozuv tayyor. Tinglab ko‘rishingiz mumkin.";
      }else{
        d.failed=true;
        $("voiceStatus").textContent="Yozuv saqlanmadi. Qisqaroq yozib ko‘ring.";
      }
      refreshVoiceControls();
    };
    recorder.start(500);d.started=performance.now();
    d.clock=setInterval(()=>showVoiceTime(d.started),250);
    $("voiceStatus").textContent="Ovoz yozilmoqda…";refreshVoiceControls();
  }catch(e){
    if(voiceDraft!==d)return;
    d.failed=true;releaseVoice(d);
    $("voiceStatus").textContent=e.name==="NotAllowedError"?"Mikrofonga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat berishingiz mumkin.":"Mikrofonni ochib bo‘lmadi. Qayta urinib ko‘ring.";
    refreshVoiceControls();
  }
}
function voiceSendFailed(d,message){
  if(voiceDraft!==d)return;
  clearTimeout(d.timeout);d.busy=false;
  $("voiceStatus").textContent=message;refreshVoiceControls();
}
function voiceReceipt(e){
  const d=voiceDraft;
  if(!d || !e.tag || e.tag!==d.tag)return false;
  if(e.type==="saved"){closeVoice();return true;}
  if(e.type==="error"){voiceSendFailed(d,e.message);return true;}
  return false;
}
async function deliverVoice(){
  const d=voiceDraft;
  if(!d?.blob || d.busy || !rosterReady || d.owner!==me?.id)return;
  d.busy=true;refreshVoiceControls();
  $("voicePreview").pause();$("voiceStatus").textContent="Yozuv yuborilmoqda…";
  d.controller=new AbortController();
  const timer=setTimeout(()=>d.controller.abort(),45000);
  try{
    await uploadMediaOnce(d,"ovoz."+d.blob.type.split("/")[1],d.controller.signal);
    if(voiceDraft!==d || me?.id!==d.owner)return;
    d.tag=crypto.randomUUID();
    if(!sendWS({type:"message",recipient:d.room||null,body:"[voice]",media_id:d.mediaId,tag:d.tag})){
      voiceSendFailed(d,"Ulanish tiklangach qayta yuboring.");return;
    }
    d.timeout=setTimeout(()=>voiceSendFailed(d,"Tasdiq kelmadi. Ulanishni tekshirib qayta urining."),20000);
  }catch(e){
    voiceSendFailed(d,e.name==="AbortError"?"Yuklash cho‘zildi. Qayta urining.":e.message);
  }finally{clearTimeout(timer);}
}
function setupVoiceTools(){
  $("micBtn").onclick=recordVoice;
  $("voiceRedo").onclick=recordVoice;
  $("voiceStop").onclick=()=>{
    const recorder=voiceDraft?.recorder;
    if(recorder?.state==="recording"){recorder.stop();refreshVoiceControls();}
  };
  $("voiceClose").onclick=closeVoice;
  $("voiceDialog").addEventListener("cancel",e=>{e.preventDefault();if(!voiceDraft?.busy)closeVoice();});
  $("voiceSend").onclick=deliverVoice;
  window.addEventListener("pagehide",closeVoice);
}
