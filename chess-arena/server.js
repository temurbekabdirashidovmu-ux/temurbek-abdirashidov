import express from 'express';
import http from 'node:http';
import {Server} from 'socket.io';
import {Chess} from 'chess.js';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json({limit:'20kb'}));app.use(express.static('public'));
const rooms=new Map();
app.get('/health',(_,res)=>res.json({ok:true,engine:'stockfish'}));
function engine(fen,depth=12){return new Promise((resolve,reject)=>{const p=spawn(process.env.STOCKFISH_PATH||'/usr/games/stockfish');let output='',done=false;const timer=setTimeout(()=>finish(new Error('Engine timeout')),12000);function finish(err,result){if(done)return;done=true;clearTimeout(timer);p.kill();err?reject(err):resolve(result)}p.on('error',finish);p.stdout.on('data',d=>{output+=d.toString();if(output.length>500000)output=output.slice(-100000);const match=output.match(/bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/);if(match){const scores=[...output.matchAll(/score (cp|mate) (-?\d+)/g)],last=scores.at(-1);finish(null,{bestmove:match[1],score:last?{type:last[1],value:Number(last[2])}:null});}});p.stdin.write('uci\nisready\nposition fen '+fen+'\ngo depth '+Math.max(4,Math.min(18,Number(depth)||12))+'\n');});}
let active=0;
app.post('/api/engine/evaluate',async(req,res)=>{if(active>=2)return res.status(429).json({error:'Engine busy'});try{const g=new Chess(req.body?.fen);active++;const data=await engine(g.fen(),req.body?.depth);res.json(data)}catch(e){res.status(400).json({error:e.message})}finally{if(active>0)active--}});
const snapshot=r=>({id:r.id,fen:r.game.fen(),pgn:r.game.pgn(),history:r.game.history({verbose:true}),players:{w:!!r.w,b:!!r.b},result:r.result,clock:r.clock});
function emit(r){io.to(r.id).emit('state',snapshot(r))}
io.on('connection',s=>{
s.on('create',(minutes,ack)=>{const id=randomBytes(4).toString('hex'),m=[1,3,5,10,15,30].includes(Number(minutes))?Number(minutes):10;const r={id,game:new Chess(),w:s.id,b:null,clock:{w:m*60000,b:m*60000},last:Date.now(),result:null};rooms.set(id,r);s.join(id);s.data.id=id;ack?.({ok:true,id,color:'w',state:snapshot(r)});});
s.on('join',(id,ack)=>{const r=rooms.get(String(id).trim().toLowerCase());if(!r)return ack?.({ok:false,error:'Room not found'});const color=!r.w?'w':!r.b?'b':null;if(!color)return ack?.({ok:false,error:'Room full'});r[color]=s.id;s.join(r.id);s.data.id=r.id;r.last=Date.now();ack?.({ok:true,id:r.id,color,state:snapshot(r)});emit(r)});
s.on('move',(m,ack)=>{const r=rooms.get(s.data.id);if(!r||r.result||!r.w||!r.b)return ack?.({ok:false,error:'Game unavailable'});if(r[r.game.turn()]!==s.id)return ack?.({ok:false,error:'Not your turn'});try{r.game.move({from:m.from,to:m.to,promotion:m.promotion||'q'});r.last=Date.now();if(r.game.isGameOver())r.result=r.game.isCheckmate()?(r.game.turn()==='w'?'0-1':'1-0'):'1/2-1/2';emit(r);ack?.({ok:true})}catch{ack?.({ok:false,error:'Illegal move'})}});
s.on('resign',()=>{const r=rooms.get(s.data.id);if(r&&!r.result&&(r.w===s.id||r.b===s.id)){r.result=r.w===s.id?'0-1':'1-0';emit(r)}});
s.on('disconnect',()=>{const r=rooms.get(s.data.id);if(r){if(r.w===s.id)r.w=null;if(r.b===s.id)r.b=null;emit(r)}});
});
setInterval(()=>{for(const r of rooms.values()){if(r.result||!r.w||!r.b)continue;const now=Date.now(),t=r.game.turn();r.clock[t]=Math.max(0,r.clock[t]-(now-r.last));r.last=now;if(!r.clock[t])r.result=t==='w'?'0-1':'1-0';emit(r)}},1000).unref();
server.listen(process.env.PORT||3000,'0.0.0.0');
