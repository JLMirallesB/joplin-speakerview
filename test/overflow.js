/*
 * Diagnóstico: recorre todas las diapositivas y lista el texto cuya palabra
 * más larga NO cabe a lo ancho, que es donde reveal la parte por la mitad.
 * Necesita el servidor levantado (mejor con --no-fit, para ver el estado crudo).
 *
 *   node bin/cli.js <ruta> --no-open --no-fit &
 *   node test/overflow.js
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sv-sw-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port=9340',`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu',
  '--window-size=1440,900','http://localhost:7777/present/d0'],{stdio:'ignore'});
let ws;
try{
 let t=null;
 for(let i=0;i<60&&!t;i++){await sleep(250);
  try{const l=await (await fetch('http://127.0.0.1:9340/json/list')).json();
      t=l.find(x=>x.type==='page'&&x.url.includes('/present/'));}catch{}}
 ws=new WebSocket(t.webSocketDebuggerUrl,{maxPayload:256*1024*1024});
 await new Promise(r=>ws.once('open',r));
 let id=0;const pend=new Map();
 ws.on('message',m=>{const o=JSON.parse(m);const p=pend.get(o.id);if(p){pend.delete(o.id);p(o);}});
 const send=(m2,p2={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m2,params:p2}));});
 const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result?.result?.value;
 await send('Runtime.enable');
 for(let i=0;i<60;i++){await sleep(250); if(await ev(`!!document.querySelector('.reveal .slides section.present')`)) break;}
 await sleep(2000);
 const n = await ev(`document.querySelectorAll('.reveal .slides > section').length`);
 const probe = `JSON.stringify((function(){
   var out=[], ctx=document.createElement('canvas').getContext('2d');
   var SEL='h1,h2,h3,h4,h5,h6,p,li,blockquote,code,figcaption';
   var slides=document.querySelectorAll('.reveal .slides section.present');
   for (var s=0;s<slides.length;s++){
     var all=slides[s].querySelectorAll(SEL);
     for (var i=0;i<all.length;i++){
       var el=all[i];
       if (el.querySelector(SEL)) continue;
       var text=(el.innerText||el.textContent||'').trim(); if(!text) continue;
       var avail=el.clientWidth; if(!avail) continue;
       var cs=getComputedStyle(el);
       ctx.font=cs.fontStyle+' '+cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
       var words=text.split(/\\s+/), max=0, worst='';
       for (var w=0;w<words.length;w++){ var ww=ctx.measureText(words[w]).width; if(ww>max){max=ww;worst=words[w];} }
       if (max>avail+1) out.push({tag:el.tagName, clase:String(el.className||'').slice(0,24),
                                palabra:worst, ancho:Math.round(max), hueco:avail,
                                cuerpo:cs.fontSize, ratio:+(max/avail).toFixed(2)});
     }
   }
   return out;
 })())`;
 const hits=[];
 for (let h=0; h<n; h++){
   await ev(`window.postMessage(JSON.stringify({method:'slide',args:[${h},0,-1]}),'*')`);
   await sleep(230);
   const r=JSON.parse(await ev(probe)||'[]');
   r.forEach(x=>hits.push(Object.assign({h},x)));
 }
 console.log(JSON.stringify(hits));
}finally{ws?.close();chrome.kill();await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
