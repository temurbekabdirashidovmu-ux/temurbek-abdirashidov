import {pbkdf2Sync,timingSafeEqual,randomBytes,createHash} from 'node:crypto';
export const digest=s=>createHash('sha256').update(s).digest('hex');
export const nonce=()=>randomBytes(32).toString('hex');
export function validPassword(value,salt,expected){if(typeof value!=='string'||value.length>256||!salt||!expected)return false;const computed=pbkdf2Sync(value,salt,600000,32,'sha256');const wanted=Buffer.from(expected,'hex');return wanted.length===computed.length&&timingSafeEqual(wanted,computed)}
export function sessionToken(req,name){return req.headers.get('cookie')?.match(new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})'))?.[1]}
export async function entryAllowed(req,env){if(!env.SITE_ENTRY_HASH)return false;const token=sessionToken(req,'portfolio_entry');if(!token)return false;const obj=await env.BUCKET.get('portfolio/state-v1.json');if(!obj)return false;const state=await obj.json();return !!state.entries?.some(x=>x.hash===digest(token)&&x.expires>Date.now())}
export function teacherUnlocked(req,state){const token=sessionToken(req,'portfolio_session');return !!token&&state.sessions.some(x=>x.hash===digest(token)&&x.teacherUntil>Date.now()&&x.expires>Date.now())}
export const entryCookie=t=>`portfolio_entry=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`;
