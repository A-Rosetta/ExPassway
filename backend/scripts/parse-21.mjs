import fs from 'node:fs/promises';

const f='/home/ubuntu/chemis/txt/0620_s23_qp_21.txt';
let t=await fs.readFile(f,'utf8');

t=t.replace(/\r/g,' ')
 .replace(/=== PAGE \d+ ===/g,' ')
 .replace(/© UCLES 2023/g,' ')
 .replace(/\[Turn over/g,' ')
 .replace(/BLANK PAGE/g,' ')
 .replace(/Group\s+The Periodic Table of Elements[\s\S]*$/i,' ')
 .replace(/\s+/g,' ')
 .trim();

function sliceByQ(q){
  const startRe = q===1 ? /\s1\s{1,}(?=The\sdiagram|Four\sphysical\schanges|Which\srow|What\sis)/i : new RegExp(`\\s${q}\\s{1,}`);
  const s = t.search(startRe);
  if (s<0) return '';
  const from = s + String(q).length + 1;
  if(q===40) return t.slice(from);
  const endRe = new RegExp(`\\s${q+1}\\s{1,}`);
  const rest=t.slice(from);
  const e=rest.search(endRe);
  return e<0?rest:rest.slice(0,e);
}

function parseSeg(seg){
  const idxA=seg.search(/\sA\s{1,}/);
  const idxB=seg.search(/\sB\s{1,}/);
  const idxC=seg.search(/\sC\s{1,}/);
  const idxD=seg.search(/\sD\s{1,}/);
  if([idxA,idxB,idxC,idxD].some(x=>x<0)) return null;
  if(!(idxA<idxB && idxB<idxC && idxC<idxD)) return null;
  const stem=seg.slice(0,idxA).trim();
  const a=seg.slice(idxA+2,idxB).trim();
  const b=seg.slice(idxB+2,idxC).trim();
  const c=seg.slice(idxC+2,idxD).trim();
  const d=seg.slice(idxD+2).trim();
  if(!stem||!a||!b||!c||!d) return null;
  return {stem,options:[a,b,c,d]};
}

const out=[];
for(let q=1;q<=40;q++){
  const seg=sliceByQ(q);
  const p=parseSeg(seg);
  if(p) out.push({q,...p});
}
console.log('parsed',out.length);
for(const row of out.slice(0,8)){
  console.log('\nQ'+row.q, row.stem.slice(0,140));
  console.log('A',row.options[0].slice(0,80));
}
