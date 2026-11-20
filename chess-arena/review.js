import {Chess} from 'chess.js';
const cp = score => score?.type==='cp'?score.value:score?.type==='mate'?(score.value>0?10000:-10000):0;
export function classify({before,after,played,best,fen}){
 const game=new Chess(fen);
 const legal=game.moves({verbose:true});
 const move=legal.find(m=>m.from===played.slice(0,2)&&m.to===played.slice(2,4)&&(played.length<5||m.promotion===played[4]));
 if(!move)return {label:'Illegal',loss:null};
 const sign=game.turn()==='w'?1:-1;
 const bestScore=cp(best)*sign, actualScore=cp(after)*sign;
 const loss=Math.max(0,bestScore-actualScore);
 let label=loss<=15?'Best':loss<=35?'Excellent':loss<=70?'Good':loss<=130?'Inaccuracy':loss<=300?'Mistake':'Blunder';
 if(played===before?.bestmove)label='Best';
 if(move.san.endsWith('#'))label='Best';
 // A heuristic only; not equivalent to Chess.com proprietary Brilliant classification.
 if(move.captured && loss<=30 && bestScore>150 && game.isCheck()===false && played===before?.bestmove && move.piece!=='p')label='Great';
 return {label,loss,centipawns:actualScore,heuristic:true};
}
export function elo(a,b,score,k=24){const expected=1/(1+10**((b-a)/400));return Math.round(a+k*(score-expected))}
