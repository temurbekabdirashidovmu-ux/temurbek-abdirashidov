import assert from 'node:assert/strict';
import {req,owner,learner} from './media.mjs';
const students=(await req('public')).data.students,id=students[0].id,other=students[1].id;
const goal=await req('profile/'+id+'/targets','POST',{title:'Tiklanadigan maqsad'},learner);assert.equal(goal.status,200);assert.equal((await req('profile/'+id+'/targets/'+goal.data.id,'DELETE',undefined,learner)).status,200);
assert.equal((await req('profile/'+id+'/recycle')).status,401);assert.equal((await req('profile/'+other+'/recycle','GET',undefined,learner)).status,403);
let recycle=await req('profile/'+id+'/recycle','GET',undefined,learner);assert(recycle.data.items.some(x=>x.id===goal.data.id));assert(!JSON.stringify(recycle.data).includes('authorLogin'));
assert.equal((await req('profile/'+other+'/recycle/'+goal.data.id,'POST',{},learner)).status,403);assert.equal((await req('profile/'+id+'/recycle/'+goal.data.id,'POST',{},learner)).status,200);assert.equal((await req('profile/'+id+'/recycle/'+goal.data.id,'POST',{},learner)).status,404);assert((await req('profile/'+id)).data.student.targets.some(x=>x.id===goal.data.id));
const award=await req('profile/'+id+'/milestones','POST',{title:'Tiklanadigan yutuq',date:'2026-11-01'},owner);assert.equal((await req('profile/'+id+'/milestones/'+award.data.id,'DELETE',undefined,owner)).status,200);recycle=await req('profile/'+id+'/recycle','GET',undefined,learner);assert(!recycle.data.items.some(x=>x.id===award.data.id));assert.equal((await req('profile/'+id+'/recycle/'+award.data.id,'POST',{},learner)).status,403);assert.equal((await req('profile/'+id+'/recycle/'+award.data.id,'POST',{},owner)).status,200);assert.equal((await req('profile/'+id)).data.student.milestones.find(x=>x.id===award.data.id).reviewedBy.role,'owner');
// Keep the UI fixture goal counts unchanged while leaving a record to restore there.
await req('profile/'+id+'/targets/'+goal.data.id,'DELETE',undefined,learner);
console.log('Passed: per-profile recycle visibility, authorized goal restoration, staff-only achievement restoration and replay protection.');
export {req,owner,learner};
