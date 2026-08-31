/*
 * Captura la vista del ponente. Necesita el servidor levantado.
 *
 *   node test/screenshot.js salida.png [id-de-boton-a-pulsar]
 *   node test/screenshot.js grid.png grid-open
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const [,,OUT,ACTION]=process.argv;
const PORT=9345;
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sv-s-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu',
  '--window-size=1500,940','http://localhost:7777/present/d0'],{stdio:'ignore'});
const targets=async()=>(await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
async function attach(u){const ws=new WebSocket(u,{maxPayload:512*1024*1024});
 await new Promise(r=>ws.once('open',r)); let id=0;const pend=new Map();
 ws.on('message',m=>{const o=JSON.parse(m);const p=pend.get(o.id);if(p){pend.delete(o.id);p(o);}});
 const send=(m2,p2={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m2,params:p2}));});
 return {ws,send,eval:async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result?.result?.value};}
let deck,sp;
try{
 let t=null; for(let i=0;i<60&&!t;i++){await sleep(250);
   try{t=(await targets()).find(x=>x.url.includes('/present/'));}catch{}}
 deck=await attach(t.webSocketDebuggerUrl); await deck.send('Runtime.enable');
 for(let i=0;i<60;i++){await sleep(250); if(await deck.eval(`!!document.querySelector('.reveal .slides section.present')`)) break;}
 await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:7777/speaker/d0')}`,{method:'PUT'});
 let s=null; for(let i=0;i<40&&!s;i++){await sleep(250); s=(await targets()).find(x=>x.url.includes('/speaker/'));}
 sp=await attach(s.webSocketDebuggerUrl); await sp.send('Runtime.enable');
 await sp.send('Emulation.setDeviceMetricsOverride',{width:1500,height:940,deviceScaleFactor:2,mobile:false});
 await sleep(7000);
 const spy=new WebSocket('ws://localhost:7777/ws');
 await new Promise(r=>spy.once('open',r));
 spy.send(JSON.stringify({t:'hello',deckId:'d0',role:'remote'}));
 spy.send(JSON.stringify({t:'cmd',cmd:'goto',deckId:'d0',args:[41,0,0]}));
 spy.send(JSON.stringify({t:'cmd',cmd:'timer',action:'start',deckId:'d0'}));
 await sleep(2500);
 if (ACTION) { await sp.eval(`document.getElementById('${ACTION}').click()`); await sleep(1400); }
 const shot=await sp.send('Page.captureScreenshot',{format:'png'});
 await fs.writeFile(OUT, Buffer.from(shot.result.data,'base64'));
 spy.close();
}finally{deck?.ws.close();sp?.ws.close();chrome.kill();await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
