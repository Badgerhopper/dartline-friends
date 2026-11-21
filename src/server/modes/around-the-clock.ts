/**
 * DartLine Friends: Around the Clock 1–20, optional bull finish.
 * Copyright 2026 DartLine contributors, AGPL-3.0-only.
 */
import type { DartThrow, ModePanel, ModeView, ViewText, Visit } from '../../shared/types';
import type { ModeSettings } from '../../shared/settings';
import { boolOr,stringOr } from '../../shared/settings';
import type { FinalizedVisit, GameMode, LegContext } from './types';
import { registerMode } from './types';

const MAX_DARTS=3;
function pad(darts:DartThrow[]):DartThrow[]{
  const miss=():DartThrow=>({x:0,y:0,score:{label:'miss',points:0,mult:0,base:0}});
  return darts.concat(Array.from({length:Math.max(0,MAX_DARTS-darts.length)},miss));
}
function count(s:ModeSettings){return boolOr(s,'finishOnBull',true)?21:20;}
function matches(d:DartThrow,next:number,settings:ModeSettings):boolean{
  const {label,base,mult}=d.score;
  if(next===21) return label==='SB'||label==='DB';
  if(base!==next) return false;
  const required=stringOr(settings,'requiredRing','any');
  return required==='any'||(required==='double'?mult===2:mult===3);
}
function progress(ctx:LegContext,withCurrent=true):Record<string,number>{
  const scores:Record<string,number>=Object.fromEntries(ctx.players.map(p=>[p.id,0]));
  const apply=(player:string,darts:DartThrow[])=>{
    if(scores[player]===undefined) return;
    for(const dart of darts){
      const next=scores[player]+1;
      if(next<=count(ctx.settings)&&matches(dart,next,ctx.settings)) scores[player]++;
    }
  };
  for(const visit of ctx.visits) if(!visit.voided) apply(visit.playerId,visit.darts);
  if(withCurrent&&ctx.currentVisit) apply(ctx.currentVisit.playerId,ctx.currentVisit.darts);
  return scores;
}
function target(n:number){return n===21?'BULL':String(n);}
export const aroundTheClock:GameMode={
  id:'around-the-clock',label:'Around the Clock',
  defaults:{requiredRing:'any',finishOnBull:true},
  fields:[
    {key:'requiredRing',label:'Required hits',kind:'select',options:[
      {value:'any',label:'Any ring'},{value:'double',label:'Doubles only'},
      {value:'triple',label:'Triples only'}]},
    {key:'finishOnBull',label:'Bull to finish',kind:'toggle'},
  ],
  dartsPerVisit(){return MAX_DARTS;},
  isVisitLocked(ctx){
    const cv=ctx.currentVisit;
    return Boolean(cv&&(cv.darts.length>=MAX_DARTS || progress(ctx)[cv.playerId]>=count(ctx.settings)));
  },
  finalizeVisit(ctx):FinalizedVisit{
    const playerId=ctx.currentVisit?.playerId??ctx.currentPlayerId;
    const darts=ctx.currentVisit?.darts??[];
    const won=darts.length>0&&progress(ctx)[playerId]>=count(ctx.settings);
    const visit:Visit={playerId,darts:won?[...darts]:pad(darts),
      visitNumber:ctx.visits.length+1,voided:false};
    return {visit,legWinnerId:won?playerId:null};
  },
  view(ctx):ModeView{
    const scores=progress(ctx),total=count(ctx.settings);
    const playerScores:Record<string,ViewText>={};
    for(const p of ctx.players) playerScores[p.id]=
      scores[p.id]>=total?'FINISHED':'→ '+target(scores[p.id]+1);
    return {headline:'Around the Clock',
      notice:'Hit 1 through 20 in order'+(total===21?', then bull.':'.'),
      playerScores,visitTotal:(ctx.currentVisit?.darts.length??0)+' of 3 darts',
      dartsPerVisit:MAX_DARTS,slots:ctx.currentVisit?.darts.map(d=>d.score.label),
      history:[...ctx.visits].reverse().map(v=>
        (ctx.players.find(p=>p.id===v.playerId)?.name??'Player')+': '+v.darts.map(d=>d.score.label).join(' '))};
  },
  panel(match):ModePanel{
    const ctx:LegContext={settings:match.settings.modeSettings,players:match.players,
      currentPlayerId:match.players[match.currentPlayerIndex]?.id??'',
      visits:match.visits,currentVisit:match.currentVisit};
    const scores=progress(ctx),total=count(ctx.settings);
    return {title:'Target progress',render:'table',rows:[
      {label:'Completed',values:Object.fromEntries(match.players.map(p=>[p.id,scores[p.id]+'/'+total]))},
      {label:'Next target',values:Object.fromEntries(match.players.map(p=>[p.id,
        scores[p.id]>=total?'Finished':target(scores[p.id]+1)]))},
    ]};
  },
};
registerMode(aroundTheClock);
