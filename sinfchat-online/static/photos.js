const photoBudget=850*1024;
const imageTypes=["image/jpeg","image/png","image/webp"];
let photoDraft=null, viewedMessage=null;

async function preparePhoto(file,source){
  const image=new Image();
  image.src=source;
  await image.decode();
  if(file.size<=photoBudget)return file;
  const canvas=document.createElement("canvas");
  for(const edge of [3000,2400,1800,1280,960]){
    const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext("2d");
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.87));
    if(blob && blob.size<=photoBudget && imageTypes.includes(blob.type))return blob;
  }
  throw new Error("Rasmni joylash uchun kichraytirib bo‘lmadi.");
}

function refreshPhotoControls(){
  if(!photoDraft)return;
  const busy=photoDraft.busy;
  $("photoSend").disabled=busy || !photoDraft.blob || !rosterReady;
  $("photoSend").textContent=busy?"Yuborilmoqda…":rosterReady?"Yuborish":"Ulanish kutilmoqda…";
  $("photoCaption").disabled=busy;
  $("photoClose").disabled=busy;
}
function closePhotoDraft(){
  if(!photoDraft)return;
  clearTimeout(photoDraft.timer);
  URL.revokeObjectURL(photoDraft.url);
  photoDraft=null;
  $("photoPreview").removeAttribute("src");$("photoCaption").value="";
  if($("photoDialog").open)$("photoDialog").close();
}
async function stagePhoto(file){
  if(!me || !file || photoDraft)return;
  if(!imageTypes.includes(file.type)){toast("JPEG, PNG yoki WebP rasm tanlang.",true);return;}
  const draft={owner:me.id,room:peer,url:URL.createObjectURL(file),busy:false,blob:null};
  photoDraft=draft;
  $("photoRoom").textContent="Suhbat · "+$("chatName").textContent;
  $("photoStatus").textContent="Rasm tayyorlanmoqda…";
  $("photoPreview").src=draft.url;$("photoCaption").value="";
  refreshPhotoControls();$("photoDialog").showModal();
  try{
    const blob=await preparePhoto(file,draft.url);
    if(photoDraft!==draft)return;
    if(blob!==file){
      URL.revokeObjectURL(draft.url);draft.url=URL.createObjectURL(blob);
      $("photoPreview").src=draft.url;
    }
    draft.blob=blob;
    const kb=Math.ceil(blob.size/1024);
    $("photoStatus").textContent=(blob===file?"Asl hajm":"Yuborish uchun kichraytirildi")+" · "+kb+" KB";
    refreshPhotoControls();
  }catch(e){
    if(photoDraft===draft)$("photoStatus").textContent="Rasm ochilmadi. Boshqa rasm tanlang.";
  }
}
function photoFailed(draft,message){
  if(photoDraft!==draft)return;
  clearTimeout(draft.timer);draft.busy=false;
  $("photoStatus").textContent=message;refreshPhotoControls();
}
function photoReceipt(event){
  const draft=photoDraft;
  if(!event.tag || !draft || event.tag!==draft.tag)return false;
  if(event.type==="saved"){closePhotoDraft();return true;}
  if(event.type==="error"){photoFailed(draft,event.message);return true;}
  return false;
}
async function sendPhoto(event){
  event.preventDefault();
  const draft=photoDraft;
  if(!draft?.blob || draft.busy || !rosterReady || me?.id!==draft.owner)return;
  const caption=$("photoCaption").value.trim();
  if(caption==="[voice]"){
    $("photoStatus").textContent="Bu belgi ovozli xabar uchun ishlatiladi. Boshqa izoh yozing.";return;
  }
  draft.busy=true;refreshPhotoControls();$("photoStatus").textContent="Rasm yuborilmoqda…";
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),45000);
  try{
    if(!draft.mediaId){
      const form=new FormData();
      form.append("file",draft.blob,"rasm."+draft.blob.type.split("/")[1]);
      const result=await api("/api/media",{method:"POST",body:form,signal:controller.signal});
      draft.mediaId=result.media_id;
    }
    if(photoDraft!==draft || me?.id!==draft.owner)return;
    draft.tag=crypto.randomUUID();
    if(!sendWS({type:"message",recipient:draft.room||null,body:caption,media_id:draft.mediaId,tag:draft.tag})){
      photoFailed(draft,"Ulanish tiklangach, qayta yuborishingiz mumkin.");return;
    }
    draft.timer=setTimeout(()=>photoFailed(draft,"Tasdiq kelmadi. Ulanishni tekshiring va qayta urining."),20000);
  }catch(e){
    photoFailed(draft,e.name==="AbortError"?"Yuklash cho‘zildi. Yana urinib ko‘ring.":e.message);
  }finally{clearTimeout(timeout);}
}

function photoThumbnail(mediaId,caption,author,messageId=null){
  const button=document.createElement("button");button.type="button";button.className="photo-thumb";
  button.setAttribute("aria-label","Rasmni ochish");button.setAttribute("aria-haspopup","dialog");
  const image=document.createElement("img");image.loading="lazy";image.alt=caption||"Suhbatdagi rasm";image.src="/media/"+mediaId;
  button.append(image);
  button.onclick=()=>{
    viewedMessage=messageId;
    $("pictureFull").src=image.src;
    $("pictureTitle").textContent=author?"@"+author+" · Rasm":"Rasm";
    $("pictureCaption").textContent=caption||"";$("pictureCaption").hidden=!caption;
    setPhotoZoom(false);$("pictureViewer").showModal();
  };
  return button;
}
function setPhotoZoom(active){
  $("pictureViewport").classList.toggle("zoomed",active);
  $("pictureZoom").setAttribute("aria-pressed",String(active));
  $("pictureZoom").textContent=active?"Ekranga sig‘dirish":"Kattalashtirish";
  $("pictureViewport").scrollTo(0,0);
}
function setupPhotoTools(){
  $("attachPhoto").onclick=()=>$("imageInput").click();
  $("imageInput").onchange=e=>{const file=e.target.files[0];e.target.value="";stagePhoto(file);};
  $("messageInput").addEventListener("paste",event=>{
    const file=Array.from(event.clipboardData?.files||[]).find(f=>imageTypes.includes(f.type));
    if(file){event.preventDefault();stagePhoto(file);}
  });
  $("photoClose").onclick=closePhotoDraft;
  $("photoDialog").addEventListener("cancel",event=>{
    event.preventDefault();if(!photoDraft?.busy)closePhotoDraft();
  });
  $("photoForm").onsubmit=sendPhoto;
  $("pictureZoom").onclick=()=>setPhotoZoom($("pictureZoom").getAttribute("aria-pressed")!=="true");
  $("pictureClose").onclick=()=>$("pictureViewer").close();
  $("pictureViewer").addEventListener("close",()=>{
    viewedMessage=null;$("pictureFull").removeAttribute("src");$("pictureCaption").textContent="";
  });
}
