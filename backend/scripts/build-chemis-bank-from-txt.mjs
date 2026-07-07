import fs from 'node:fs/promises';
import path from 'node:path';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

const { getDocument } = pdfjs;
const TXT_DIR='/home/ubuntu/chemis/txt';
const ANSWER_DIR='/home/ubuntu/chemis/answer';
const OUT='/home/ubuntu/alevel-smart-practice/backend/src/data/chemisBank.json';
const QP_RE=/^0620_(s23|w23)_qp_(2[123])(?:\(\d+\))?\.txt$/i;
const MS_RE=/^0620_(s23|w23)_ms_(2[123]).*\.pdf$/i;

const L2I={A:0,B:1,C:2,D:3};
const norm=s=>String(s||'').replace(/\r/g,'').replace(/\s+/g,' ').trim();

async function readPdfText(abs){
 const data=new Uint8Array(await fs.readFile(abs));
 const doc=await getDocument({data}).promise;
 let out='';
 for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i); const c=await p.getTextContent(); out+=' '+c.items.map(x=>x.str).join(' ');} 
 return norm(out);
}

async function listRec(root){const out=[]; async function walk(d){for(const e of await fs.readdir(d,{withFileTypes:true})){const a=path.join(d,e.name); if(e.isDirectory()) await walk(a); else out.push(a);}} await walk(root); return out;}

function parseAns(t){const m=new Map(); const re=/(?:^|\s)([1-9]|[12]\d|3\d|40)\s+([ABCD])\s+1(?=\s|$)/g; let x; while((x=re.exec(t))){const q=+x[1]; if(!m.has(q)) m.set(q,L2I[x[2]]);} return m;}

function extractQuestionsFromText(text){
 const work=norm(text.replace(/=== PAGE \d+ ===/g,' ').replace(/Group The Periodic Table of Elements[\s\S]*$/i,' '));
 const out=[];
 for(let q=1;q<=40;q++){
  const startRe=new RegExp(`\\s${q}\\s{2,}`);
  const s=work.search(startRe); if(s<0) continue;
  const next=q<40? new RegExp(`\\s${q+1}\\s{2,}`):null;
  const tail=work.slice(s+String(q).length+2);
  const seg=next? tail.slice(0, Math.max(0, tail.search(next))) : tail;

  // strongest pattern: explicit A/B/C/D anchors
  let m=seg.match(/([\s\S]*?)\sA\s{2,}([\s\S]*?)\sB\s{2,}([\s\S]*?)\sC\s{2,}([\s\S]*?)\sD\s{2,}([\s\S]*?)$/);
  if(!m){
    // fallback: allow trailing content after D option
    m=seg.match(/([\s\S]*?)\sA\s{2,}([\s\S]*?)\sB\s{2,}([\s\S]*?)\sC\s{2,}([\s\S]*?)\sD\s{2,}([\s\S]*?)(?=\s(?:[1-9]|[12]\\d|3\\d|40)\\s{2,}|$)/);
  }
  if(!m) continue;
  const stem=norm(m[1]);
  const options=[norm(m[2]),norm(m[3]),norm(m[4]),norm(m[5])];
  if(!stem || options.some(o=>!o)) continue;
  out.push({q,stem,options});
 }
 return out;
}

const ansFiles=(await listRec(ANSWER_DIR)).filter(f=>MS_RE.test(path.basename(f)));
const ansByPaper=new Map();
for(const f of ansFiles){const b=path.basename(f); const mm=b.match(MS_RE); if(!mm) continue; ansByPaper.set(`${mm[1].toLowerCase()}_${mm[2]}`, parseAns(await readPdfText(f)));}

const qFiles=(await fs.readdir(TXT_DIR)).filter(f=>QP_RE.test(f)).sort();
const bank=[];
for(const f of qFiles){
 const mm=f.match(QP_RE); const key=`${mm[1].toLowerCase()}_${mm[2]}`;
 const ans=ansByPaper.get(key)||new Map();
 const txt=await fs.readFile(path.join(TXT_DIR,f),'utf8');
 const rows=extractQuestionsFromText(txt);
 for(const r of rows){
  bank.push({
   id:`CIE-IGCHEM-${f.replace(/\.txt$/i,'').replace(/[^\w]+/g,'-')}-${String(r.q).padStart(2,'0')}`,
   board:'CIE', subject:'IGCSE Chemistry', paper:'MCQ', difficulty:r.q<=14?'基础':(r.q<=28?'中等':'冲刺'), topic:'Past Paper MCQ',
   skills:['igcse-chemistry','mcq','past-paper'], hints:[], stem:r.stem, options:r.options, answer: ans.has(r.q)?ans.get(r.q):0
  });
 }
 console.log(f,'parsed',rows.length);
}
await fs.writeFile(OUT, JSON.stringify(bank,null,2),'utf8');
console.log('TOTAL',bank.length,'->',OUT);
