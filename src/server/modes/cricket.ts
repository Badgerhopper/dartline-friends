/**
 * DartLine Friends: standard + Cut-Throat Cricket for InstaDarts.
 * 20–15 and bull, three marks per target, multiplayer overage scoring.
 * Copyright 2026 DartLine contributors, AGPL-3.0-only.
 */
import type { DartThrow, ModePanel, ModeView, ViewText, Visit } from '../../shared/types';
import type { ModeSettings } from '../../shared/settings';
import { stringOr } from '../../shared/settings';
import type { FinalizedVisit, GameMode, LegContext } from './types';
import { registerMode } from './types';

const TARGETS = [20, 19, 18, 17, 16, 15, 25] as const;
type Target = typeof TARGETS[number];
type Board = { marks: Record<string, Record<number, number>>; points: Record<string, number> };
const MAX_DARTS = 3;
function pad(darts: DartThrow[]): DartThrow[] {
  const miss = (): DartThrow => ({ x:0,y:0,score:{label:'miss',points:0,mult:0,base:0} });
  return darts.concat(Array.from({length:Math.max(0,MAX_DARTS-darts.length)},miss));
}
function cutthroat(settings: ModeSettings) { return stringOr(settings,'scoring','standard') === 'cutthroat'; }
function segment(d: DartThrow): {target:Target;hits:number}|null {
  const {label,base,mult} = d.score;
  if (label === 'SB') return {target:25,hits:1};
  if (label === 'DB') return {target:25,hits:2};
  if ((TARGETS as readonly number[]).includes(base) && base !== 25 && mult>=1 && mult<=3)
    return {target:base as Target,hits:mult};
  return null;
}
function fresh(ctx:LegContext): Board {
  const marks:Board['marks']={},points:Board['points']={};
  for(const p of ctx.players) {
    marks[p.id]=Object.fromEntries(TARGETS.map(n=>[n,0]));
    points[p.id]=0;
  }
  return {marks,points};
}
function apply(board:Board,ctx:LegContext,player:string,dart:DartThrow) {
  const hit=segment(dart); if(!hit||!board.marks[player]) return;
  const {target,hits}=hit, before=board.marks[player][target];
  const overflow=Math.max(0,hits-Math.max(0,3-before));
  board.marks[player][target]=Math.min(3,before+hits);
  if(!overflow) return;
  const opponents=ctx.players.filter(p=>p.id!==player && board.marks[p.id][target]<3);
  if(!opponents.length) return;
  if(cutthroat(ctx.settings)) {
    for(const p of opponents) board.points[p.id]+=overflow*target;
  } else board.points[player]+=overflow*target;
}
function replay(ctx:LegContext,withCurrent=true):Board {
  const board=fresh(ctx);
  for(const visit of ctx.visits) if(!visit.voided)
    for(const dart of visit.darts) apply(board,ctx,visit.playerId,dart);
  if(withCurrent && ctx.currentVisit)
    for(const dart of ctx.currentVisit.darts) apply(board,ctx,ctx.currentVisit.playerId,dart);
  return board;
}
function hasWon(ctx:LegContext,b:Board,id:string):boolean {
  if (!b.marks[id] || !TARGETS.every(n=>b.marks[id][n]>=3)) return false;
  return ctx.players.every(p=>p.id===id || (cutthroat(ctx.settings)
    ? b.points[id]<=b.points[p.id] : b.points[id]>=b.points[p.id]));
}
function panel(ctx:LegContext,b:Board):ModePanel {
  return {title:'Cricket marks',render:'table',rows:[
    ...TARGETS.map(n=>({label:n===25?'BULL':String(n),
      values:Object.fromEntries(ctx.players.map(p=>[p.id,
        '●'.repeat(b.marks[p.id][n])+'○'.repeat(3-b.marks[p.id][n])]))})),
    {label:'Points',values:Object.fromEntries(ctx.players.map(p=>[p.id,String(b.points[p.id])]))},
  ]};
}
export const cricket:GameMode={
  id:'cricket',label:'Cricket',
  defaults:{scoring:'standard'},
  fields:[{key:'scoring',label:'Scoring',kind:'select',options:[
    {value:'standard',label:'Standard — high score wins'},
    {value:'cutthroat',label:'Cut-Throat — low score wins'},
  ]}],
  dartsPerVisit(){return MAX_DARTS;},
  isVisitLocked(ctx){
    return Boolean(ctx.currentVisit && (ctx.currentVisit.darts.length>=MAX_DARTS
      ||hasWon(ctx,replay(ctx),ctx.currentVisit.playerId)));
  },
  finalizeVisit(ctx):FinalizedVisit{
    const playerId=ctx.currentVisit?.playerId??ctx.currentPlayerId;
    const darts=ctx.currentVisit?.darts??[];
    const won=darts.length>0 && hasWon(ctx,replay(ctx),playerId);
    const visit:Visit={playerId,darts:won?[...darts]:pad(darts),
      visitNumber:ctx.visits.length+1,voided:false};
    return {visit,legWinnerId:won?playerId:null};
  },
  view(ctx):ModeView{
    const b=replay(ctx),current=ctx.currentVisit;
    const playerScores:Record<string,ViewText>={};
    for(const p of ctx.players) {
      const done=TARGETS.filter(n=>b.marks[p.id][n]>=3).length;
      playerScores[p.id]=b.points[p.id]+' • '+done+'/7';
    }
    return {headline:cutthroat(ctx.settings)?'Cut-Throat Cricket':'Standard Cricket',
      notice:'Close 20–15 and bull. Score extras until opponents close.',
      playerScores,visitTotal:(current?.darts.length??0)+' of 3 darts',
      dartsPerVisit:MAX_DARTS,slots:current?.darts.map(d=>d.score.label),
      history:[...ctx.visits].reverse().map(v=>
        (ctx.players.find(p=>p.id===v.playerId)?.name??'Player')+': '+v.darts.map(d=>d.score.label).join(' '))};
  },
  panel(match){
    const ctx:LegContext={settings:match.settings.modeSettings,players:match.players,
      currentPlayerId:match.players[match.currentPlayerIndex]?.id??'',
      visits:match.visits,currentVisit:match.currentVisit};
    return panel(ctx,replay(ctx));
  },
};
registerMode(cricket);
