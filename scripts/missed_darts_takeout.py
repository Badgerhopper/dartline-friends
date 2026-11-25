#!/usr/bin/env python3
"""DartLine v2.6: insert undetected throws safely and verify optional board-clear takeout."""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path,old,new):
    s=path.read_text(encoding='utf-8')
    if s.count(old)!=1:
        raise RuntimeError(f'v2.6 overlay mismatch {path}: {old[:90]!r}, count={s.count(old)}')
    path.write_text(s.replace(old,new,1),encoding='utf-8')
def run(root):
    for rel in [
      'src/server/scoring/verifiedBoardClear.ts',
      'tests/unit/dartline-verified-board-clear.test.ts',
      'src/client/components/MobileMatchHUD.tsx',
      'src/client/mobileMatch.css',
      'src/client/lib/tipRescue.ts',
      'tests/unit/dartline-tip-rescue.test.ts',
      'tests/unit/dartline-missing-throws.test.ts',
    ]:
        dest=root/rel
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,dest)

    match=root/'src/server/match.ts'
    patch(match,
      '/** Remove the last dart of the visit in progress (LIFO).',
      """/**
 * Insert an undetected throw at an exact position while preserving later
 * camera darts. Compare the complete expected ID list so a newly discovered
 * camera dart cannot silently shift the requested slot before the click lands.
 */
export function insertDartIntoMatch(
  match: MatchState, playerId: string, index: number, expectedIds: string[], dart: DartThrow,
): {success:true; match:MatchState} | Failure {
  const mode=activeMode(match);
  if (isFailure(mode)) return mode;
  const current=match.players[match.currentPlayerIndex];
  if (!current || current.id !== playerId) return {success:false,error:'Not your turn'};
  const cv=match.currentVisit ?? {playerId,darts:[] as DartThrow[],locked:false};
  if (cv.playerId !== playerId || cv.locked ||
    cv.darts.length >= mode.dartsPerVisit(match.settings.modeSettings)) {
    return {success:false,error:'This visit has no room for another dart'};
  }
  if (!Array.isArray(expectedIds) || expectedIds.some(id => typeof id !== 'string') ||
    expectedIds.length !== cv.darts.length ||
    !cv.darts.every((existing,i) => existing.id === expectedIds[i])) {
    return {success:false,error:'Darts changed while you were editing; reopen the missing throw'};
  }
  if (!Number.isInteger(index) || index < 0 || index > cv.darts.length)
    return {success:false,error:'Invalid dart position'};
  const darts=[...cv.darts];
  darts.splice(index,0,{...dart,id:crypto.randomUUID()});
  const next:MatchState={...match,currentVisit:{
    ...cv,id:match.currentVisit?.id??crypto.randomUUID(),darts,locked:false,
  }};
  next.currentVisit={...next.currentVisit!,locked:lockedNow(mode,next)};
  return {success:true,match:next};
}

/** Remove the last dart of the visit in progress (LIFO).""")

    protocol=root/'src/shared/protocol.ts'
    patch(protocol,
      'export interface CorrectDartMessage {',
      """export interface InsertMissedDartMessage {
  type:'insert_missed_dart';
  index:number;
  expectedIds:string[];
  dart:DartThrow;
}
export interface SetTakeoutModeMessage {
  type:'set_verified_takeout';
  enabled:boolean;
}
export interface CorrectDartMessage {""")
    patch(protocol,
      '  | CorrectDartMessage\n  | SubmitVisitMessage',
      '  | CorrectDartMessage\n  | InsertMissedDartMessage\n  | SetTakeoutModeMessage\n  | SubmitVisitMessage')

    handler=root/'src/server/wsHandler.ts'
    patch(handler,
      "import { addDartToMatch, undoDartFromMatch, correctDartInMatch, submitVisitToMatch, nextActiveIndex } from './match';",
      "import { addDartToMatch, undoDartFromMatch, correctDartInMatch, insertDartIntoMatch, submitVisitToMatch, nextActiveIndex } from './match';")
    patch(handler,
      "import { dropScoringSessions } from './scoring/store';",
      "import { dropScoringSessions, getScoringSession } from './scoring/store';")
    patch(handler,
      """    case 'correct_dart':
      handleCorrectDart(ws, msg);
      break;""",
      """    case 'correct_dart':
      handleCorrectDart(ws, msg);
      break;
    case 'insert_missed_dart':
      handleInsertMissedDart(ws,msg);
      break;
    case 'set_verified_takeout':
      handleVerifiedTakeoutSetting(ws,msg);
      break;""")
    patch(handler,
      "'add_dart', 'undo_dart', 'correct_dart', 'submit_visit',",
      "'add_dart', 'undo_dart', 'correct_dart', 'insert_missed_dart', 'set_verified_takeout', 'submit_visit',")
    patch(handler,
      'function handleSubmitVisit(ws: WebSocket): void {',
      """function handleInsertMissedDart(ws:WebSocket, msg:{
  index:unknown; expectedIds:unknown; dart:unknown;
}):void {
  const req=requireMatch(ws);
  if(!req) return;
  const {client,match}=req;
  const player=match.players[match.currentPlayerIndex];
  if(!player || !holdsPlayer(client,player.id)){
    send(ws,{type:'error',message:'Only the throwing player may add a missing dart'});
    return;
  }
  const dart=validateDartThrow(msg.dart);
  if(!dart || !Number.isInteger(msg.index) || !Array.isArray(msg.expectedIds)
    || !msg.expectedIds.every(x=>typeof x==='string')) {
    send(ws,{type:'error',message:'Invalid missing-dart entry'});
    return;
  }
  const result=insertDartIntoMatch(match,player.id,msg.index as number,msg.expectedIds,dart);
  if(!result.success) {send(ws,{type:'error',message:result.error});return;}
  commitScoredMatch(result.match);
}

/** Scorer sessions are per-board: only an actual player in this match can
 * configure their board's takeout policy. Spectators cannot opt someone else in. */
function handleVerifiedTakeoutSetting(ws:WebSocket,msg:{enabled:unknown}):void {
  const req=requireMatch(ws);
  if(!req) return;
  const {client,match}=req;
  if(typeof msg.enabled!=='boolean'){send(ws,{type:'error',message:'Invalid takeout setting'});return;}
  const mine=match.players.filter(p=>holdsPlayer(client,p.id)).map(p=>p.id);
  if(!mine.length){send(ws,{type:'error',message:'Only a player can change auto-submit'});return;}
  getScoringSession(match.id,mine,commitScoredMatch).setVerifiedTakeout(msg.enabled);
}

function handleSubmitVisit(ws: WebSocket): void {""")

    session=root/'src/server/scoring/session.ts'
    patch(session,
      "import { ThrowWindows, type WindowResult } from './throwWindow';",
      "import { ThrowWindows, type WindowResult } from './throwWindow';\nimport { VerifiedBoardClear } from './verifiedBoardClear';")
    patch(session,
      "  private consecutiveEmpty = 0;",
      """  private consecutiveEmpty = 0;
  /** Legacy mode preserves upstream non-phone workflows. Mobile explicitly
   * sends OFF by default, or VERIFIED when the player opts in. */
  private takeoutMode:'legacy'|'off'|'verified'='legacy';
  private readonly verifiedClear=new VerifiedBoardClear();

  setVerifiedTakeout(enabled:boolean):void {
    this.takeoutMode=enabled?'verified':'off';
    this.verifiedClear.reset();
    this.consecutiveEmpty=0;
    this.emptyCameras.clear();
  }""")
    patch(session,
      """      this.onEmptyBoard();
      return;
    }

    this.consecutiveEmpty = 0;""",
      """      if (this.takeoutMode === 'verified') {
        // No stale consensus: all active cameras must participate in THIS
        // completed window, report an empty tip set, and have a valid board
        // homography (enforced before an empty report can be published).
        const freshUnanimous=result.reports.length>=this.cameras.size
          && result.reports.every(report=>report.tips.length===0);
        const match=this.playableMatch();
        const eligible=Boolean(match && this.scoringPlayerId(match));
        if (this.verifiedClear.observe(freshUnanimous && eligible,
          match?.currentVisit?.darts.length ?? 0,Date.now()) && match) {
          const submitted=submitVisitToMatch(match);
          if (submitted.success) {
            this.verifiedClear.reset();
            this.opts.commit(submitted.match);
          }
        }
        return;
      }
      if (this.takeoutMode === 'legacy') this.onEmptyBoard();
      return;
    }

    this.verifiedClear.reset();
    this.consecutiveEmpty = 0;""")
    patch(session,
      "    this.emptyCameras.clear();\n    this.windows.forget(deviceId);",
      "    this.emptyCameras.clear();\n    this.verifiedClear.reset();\n    this.windows.forget(deviceId);")
    patch(session,
      "    this.tracker.reset();\n    this.consecutiveEmpty = 0;",
      "    this.tracker.reset();\n    this.verifiedClear.reset();\n    this.consecutiveEmpty = 0;")

    hook=root/'src/client/hooks/useMatch.ts'
    patch(hook,
      """  const correctDart = useCallback((index: number, expectedDartId: string, dart: DartThrow) => {
    send({ type: 'correct_dart', index, expectedDartId, dart });
  }, [send]);""",
      """  const correctDart = useCallback((index: number, expectedDartId: string, dart: DartThrow) => {
    send({ type: 'correct_dart', index, expectedDartId, dart });
  }, [send]);
  const insertMissedDart = useCallback((index:number,expectedIds:string[],dart:DartThrow) => {
    send({type:'insert_missed_dart',index,expectedIds,dart});
  },[send]);
  const setVerifiedTakeout = useCallback((enabled:boolean) => {
    send({type:'set_verified_takeout',enabled});
  },[send]);""")
    patch(hook,
      "    correctDart,\n    submitVisit,",
      "    correctDart,\n    insertMissedDart,\n    setVerifiedTakeout,\n    submitVisit,")

    app=root/'src/client/App.tsx'
    patch(app,
      "    correctDart,\n  } = useMatch",
      "    correctDart,\n    insertMissedDart,\n    setVerifiedTakeout,\n  } = useMatch")
    patch(app,
      "            correctDart={correctDart}",
      "            correctDart={correctDart}\n            insertMissedDart={insertMissedDart}\n            setVerifiedTakeout={setVerifiedTakeout}")
    patch(app,
      "  correctDart: (index: number, expectedDartId: string, dart: DartThrow) => void;",
      """  correctDart: (index: number, expectedDartId: string, dart: DartThrow) => void;
  insertMissedDart: (index:number,expectedIds:string[],dart:DartThrow)=>void;
  setVerifiedTakeout: (enabled:boolean)=>void;""")
    patch(app,
      "leaveMatch, addDart, undoDart, correctDart, submitVisit",
      "leaveMatch, addDart, undoDart, correctDart, insertMissedDart, setVerifiedTakeout, submitVisit")
    patch(app,
      "      onCorrectDart={correctDart}",
      "      onCorrectDart={correctDart}\n      onInsertDart={insertMissedDart}\n      onAutoTakeoutChange={setVerifiedTakeout}")
    patch(app,
      "        onCorrectDart={() => {}}",
      "        onCorrectDart={() => {}}\n        onInsertDart={() => {}}\n        onAutoTakeoutChange={() => {}}")

    screen=root/'src/client/pages/MatchScreen.tsx'
    patch(screen,
      "  onCorrectDart: (index: number, expectedDartId: string, dart: DartThrow) => void;",
      """  onCorrectDart: (index: number, expectedDartId: string, dart: DartThrow) => void;
  onInsertDart: (index:number,expectedIds:string[],dart:DartThrow)=>void;
  onAutoTakeoutChange: (enabled:boolean)=>void;""")
    patch(screen,
      "  onCorrectDart,\n  onSubmitVisit,",
      "  onCorrectDart,\n  onInsertDart,\n  onAutoTakeoutChange,\n  onSubmitVisit,")
    patch(screen,
      "          onCorrectDart={onCorrectDart}\n          onSubmitVisit={onSubmitVisit}",
      "          onCorrectDart={onCorrectDart}\n          onInsertDart={onInsertDart}\n          onAutoTakeoutChange={onAutoTakeoutChange}\n          onSubmitVisit={onSubmitVisit}")

    # After a visible dart was recently detected, verify a possible empty
    # board with two delayed full inferences. Don't let positive-only scans
    # silently declare a takeout, and don't keep scanning forever.
    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "  // Rescue recognition: on some phones, a small dart impact does not move enough",
      """  // A positive-only scan is useful for finding missed darts, but cannot
  // confirm dart removal. When a properly located frame has become empty
  // after a visible dart, request two independent full scans. The scoring
  // server alone decides whether they justify an opt-in takeout.
  const boardClearProbes=useRef({sawDarts:false, remaining:0});
  useEffect(() => {
    if(!vision.cameraActive || !scoring || !vision.motion.armed
      || document.visibilityState !== 'visible') {
      boardClearProbes.current={sawDarts:false,remaining:0};
      return;
    }
    const frame=vision.frame;
    if(!frame?.result || frame.result.boardKeypoints<5) return;
    if(frame.result.tips.length>0) {
      boardClearProbes.current={sawDarts:true,remaining:2};
      return;
    }
    const state=boardClearProbes.current;
    if(!state.sawDarts || state.remaining<=0) return;
    state.remaining--;
    // Do not cancel the pending confirmation when a positive-only scan
    // refreshes vision.frame 550 ms later. That was the exact reason a 900 ms
    // empty-board confirmation timer could otherwise never run.
    window.setTimeout(()=>{
      if(document.visibilityState==='visible')
        void vision.runtimeRef.current?.infer();
    },900);
  },[vision.frame,vision.cameraActive,vision.motion.armed,vision.runtimeRef,scoring]);

  // Rescue recognition: on some phones, a small dart impact does not move enough""")
    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-missed-darts-verified-takeout-v2.6-2026-11-25\n',encoding='utf-8')
    print('DartLine v2.6 missed-throw insertion and safe optional takeout installed')
if __name__=='__main__':
    try: run(Path(sys.argv[1]).resolve())
    except Exception as e:
        print('DartLine v2.6 overlay failed:',e,file=sys.stderr)
        sys.exit(1)
