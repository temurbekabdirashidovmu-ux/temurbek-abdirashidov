import PDFDocument from 'pdfkit';
import {readFile} from 'node:fs/promises';
import {finished} from 'node:stream/promises';

const margin = 48;
const ink = '#182645';
const accent = '#3c4d89';
const muted = '#50607a';
const targetStatus = {planned:'Rejalashtirilgan', active:'Bajarilmoqda', completed:'Bajarilgan'};

async function readMedia(asset, id, env) {
  try {
    if (asset && /^images\/[a-z0-9-]+\.(jpg|png)$/.test(asset)) {
      return await readFile(new URL('./' + asset, import.meta.url));
    }
    if (id) {
      const file = await env.BUCKET.get('portfolio/files/' + id);
      if (file?.body) return Buffer.from(file.body);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}

function openImage(doc, bytes) {
  if (!bytes) return null;
  try { return doc.openImage(bytes); } catch { return null; }
}

function section(doc, title, text) {
  if (!text?.trim()) return;
  doc.fontSize(15);
  const required = doc.heightOfString(title) + 45;
  if (doc.y + required > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.fillColor(accent).text(title);
  doc.moveDown(0.3).fillColor(ink).fontSize(11).text(text, {lineGap:3});
  doc.moveDown(0.85);
}

function addCover(doc, student, portrait, works, certificates) {
  const name = student.fullName || student.name;
  const width = doc.page.width - 2 * margin;
  const nameWidth = width - (portrait ? 148 : 48);
  doc.fontSize(24);
  const height = Math.max(145, 90 + doc.heightOfString(name, {width:nameWidth}));
  doc.roundedRect(margin, margin, width, height, 11).fill(ink);
  const left = margin + 22;
  doc.fillColor('#d6e0ff').fontSize(10).text('ABDULLA ORIPOV IJOD MAKTABI  /  8-A SINF', left, margin + 19);
  doc.fontSize(24).fillColor('#ffffff').text(name, left, margin + 47, {width:nameWidth});
  doc.moveDown(0.4).fontSize(11).fillColor('#d6e0ff').text('O‘quvchining shaxsiy portfoliosi', {width:nameWidth});
  if (portrait) doc.image(portrait, doc.page.width - margin - 103, margin + 18, {fit:[82,height-36],align:'center',valign:'center'});
  const top = margin + height + 12;
  const items = [
    [certificates.length, 'Sertifikatlar'],
    [works.length, 'Ijodiy ishlar'],
    [(student.targets || []).filter(t=>t.status==='completed').length, 'Bajarilgan maqsadlar']
  ];
  const col = (width - 16) / 3;
  items.forEach(([value,label], index) => {
    const x = margin + index * (col + 8);
    doc.roundedRect(x, top, col, 56, 6).fill('#eef1fa');
    doc.fillColor(ink).fontSize(18).text(String(value), x+12, top+7, {lineBreak:false});
    doc.fillColor(muted).fontSize(9).text(label, x+12, top+33, {lineBreak:false});
  });
  doc.x = margin;
  doc.y = top + 76;
}

async function addCertificate(doc, cert, index, studentName, env) {
  const bytes = await readMedia(cert.asset, cert.asset ? null : cert.id, env);
  const image = cert.type?.startsWith('image/') ? openImage(doc, bytes) : null;
  const wide = image && (image.orientation > 4 ? image.height > image.width : image.width > image.height);
  doc.addPage({size:'A4',layout:wide?'landscape':'portrait',margins:{top:margin,left:margin,right:margin,bottom:60}});
  doc.addNamedDestination('certificate-' + index);
  doc.fillColor(accent).fontSize(10).text('SERTIFIKATLAR VA TASHAKKURNOMALAR');
  doc.moveDown(0.5).fillColor(ink).fontSize(19).text(cert.title);
  doc.moveDown(0.2).fillColor(muted).fontSize(11).text(studentName);
  doc.moveDown();
  if (image) {
    const top = doc.y;
    const width = doc.page.width - 2 * margin;
    const height = doc.page.height - 64 - top;
    doc.image(image, margin, top, {fit:[width,height],align:'center',valign:'center'});
  } else if (bytes && cert.type === 'application/pdf') {
    const filename = 'sertifikat-' + (index+1) + '.pdf';
    doc.file(bytes, {name:filename,type:'application/pdf',description:cert.title});
    section(doc, 'Asl PDF hujjat', 'Sertifikat ushbu portfelga fayl sifatida biriktirilgan. PDF o‘quvchisida «Biriktirmalar» (Attachments) bo‘limini oching va '+filename+' faylini tanlang.');
  } else {
    section(doc, 'Hujjat haqida', 'Sertifikat nusxasini shaxsiy portfelning «Sertifikatlar» bo‘limida tekshiring.');
  }
}

export async function studentPDF({student,works,comments,certificates},env) {
  const doc = new PDFDocument({size:'A4',bufferPages:true,margins:{top:margin,left:margin,right:margin,bottom:60},
    info:{Title:student.name+' — Portfolio',Author:'Abdulla Oripov ijod maktabi'}});
  const chunks = [];
  doc.on('data', chunk=>chunks.push(chunk));
  const done = finished(doc);
  try {
    doc.font(new URL('./fonts/DejaVuSans.ttf',import.meta.url).pathname);
    const photo = await readMedia(student.photo, student.photoAttachment?.id, env);
    addCover(doc,student,openImage(doc,photo),works,certificates);
    section(doc,'Men haqimda',student.bio);
    section(doc,'Qiziqishlarim',student.interests);
    section(doc,'Maqsadlarim',student.goals);
    section(doc,'Yutuqlarim',student.achievement || 'Yutuqlar hali kiritilmagan.');
    if (student.profileAudio) section(doc,'Ovozli tanishtiruv','Ovozli tanishtiruvni shaxsiy portfolio sahifasida tinglash mumkin.');
    section(doc,'Ko‘nikmalarim',(student.skills || []).join(' · '));
    section(doc,'Rivojlanish rejam',(student.targets || []).map(t=>t.title+' — '+(targetStatus[t.status] || t.status)+(t.deadline?' · Muddat: '+t.deadline:'')).join('\n'));
    for (const m of [...(student.milestones || [])].sort((a,b)=>b.date.localeCompare(a.date))) {
      section(doc,m.date+' · '+m.title,[m.description,'Tasdiqlagan: '+m.reviewedBy.name].filter(Boolean).join('\n'));
    }
    for (const w of works) section(doc,'Ijodiy ish · '+w.title,w.text || w.kind);
    for (const c of comments) section(doc,'Ustoz fikri · '+c.author.name,c.text);
    if (certificates.length) {
      if (doc.y + 75 > doc.page.height - 60) doc.addPage();
      doc.fillColor(accent).fontSize(15).text('Sertifikatlar va tashakkurnomalar');
      for (const [i, cert] of certificates.entries()) {
        doc.moveDown(0.35).fillColor(accent).fontSize(11).text((i+1)+'. '+cert.title,{goTo:'certificate-'+i,underline:true});
      }
      for (const [i, cert] of certificates.entries()) await addCertificate(doc,cert,i,student.name,env);
    }
    const {count} = doc.bufferedPageRange();
    for (let i=0;i<count;i++) {
      doc.switchToPage(i);
      const {width,height} = doc.page;
      doc.page.margins.bottom = 0;
      doc.moveTo(margin,height-44).lineTo(width-margin,height-44).strokeColor('#cbd3e5').stroke();
      doc.fillColor(muted).fontSize(9).text('8-A sinf portfoliosi',margin,height-34,{lineBreak:false});
      doc.text((i+1)+' / '+count, width-margin-78,height-34,{width:78,align:'right',lineBreak:false});
    }
    doc.end();
    await done;
    return Buffer.concat(chunks);
  } catch (error) {
    doc.destroy();
    await done.catch(()=>{});
    throw error;
  }
}
