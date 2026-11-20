import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const path=process.env.DATA_FILE||'/tmp/chess-arena-users.json';
let db={users:[],games:[],tournaments:[]};
try{db=JSON.parse(readFileSync(path,'utf8'))}catch{}
function save(){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(db))}
const tokens=new Map();
export function register(username,password){
 username=String(username||'').trim();
 if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||String(password||'').length<8)throw Error('Username must be 3-24 characters and password at least 8 characters');
 if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))throw Error('Username taken');
 const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
 const u={id:randomBytes(12).toString('hex'),username,salt,hash,elo:1200,createdAt:Date.now()};db.users.push(u);save();return login(username,password)
}
export function login(username,password){
 const u=db.users.find(u=>u.username.toLowerCase()===String(username).toLowerCase());
 if(!u)throw Error('Invalid credentials');
 const a=Buffer.from(u.hash,'hex'),b=scryptSync(String(password),u.salt,64);
 if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('Invalid credentials');
 const token=randomBytes(32).toString('hex');tokens.set(token,{id:u.id,expires:Date.now()+7*86400000});return {token,user:publicUser(u)}
}
export function publicUser(u){return {id:u.id,username:u.username,elo:u.elo}}
export function authenticated(token){const t=tokens.get(token);if(!t||t.expires<Date.now())return null;return db.users.find(u=>u.id===t.id)||null}
export function leaderboard(){return db.users.map(publicUser).sort((a,b)=>b.elo-a.elo).slice(0,100)}
export function tournaments(){return db.tournaments.map(t=>({...t,players:t.players.length}))}
export function createTournament(owner,title){const t={id:randomBytes(5).toString('hex'),owner:owner.id,title:String(title).slice(0,80),players:[owner.id],status:'registration',createdAt:Date.now()};db.tournaments.push(t);save();return t}
export function joinTournament(user,id){const t=db.tournaments.find(t=>t.id===id);if(!t||t.status!=='registration')throw Error('Tournament unavailable');if(!t.players.includes(user.id)){t.players.push(user.id);save()}return t}
export function recordResult(white,black,result){const a=db.users.find(u=>u.id===white),b=db.users.find(u=>u.id===black);if(!a||!b)throw Error('Players not found');const score=result==='1-0'?1:result==='0-1'?0:.5;const ea=1/(1+10**((b.elo-a.elo)/400)),eb=1-ea;a.elo=Math.round(a.elo+24*(score-ea));b.elo=Math.round(b.elo+24*((1-score)-eb));db.games.push({white,black,result,date:Date.now()});save();return {white:publicUser(a),black:publicUser(b)}}
