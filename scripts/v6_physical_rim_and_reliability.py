#!/usr/bin/env python3
"""Unreleased v6: physical-board bounded MISS recovery and safe temporal ROI.

The project detects normal throws with the ORIGINAL motion/model pipeline.
Fallbacks must not classify wall-mounted spare darts as scored misses.
This overlay never changes model weights, homography calibration or model
thresholds inside the 170mm scoring wire. No production release.
"""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path:Path,before:str,after:str):
    s=path.read_text(encoding='utf-8')
    n=s.count(before)
    if n!=1:raise RuntimeError(f'v6 rim source mismatch {path} {before[:100]!r} x{n}')
    path.write_text(s.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/physicalBoardImpact.ts',
      'src/client/lib/idleTipRecovery.ts',
      'src/client/lib/temporalDartEvidence.ts',
      'tests/unit/dartline-physical-board-impact.test.ts',
      'tests/unit/dartline-idle-tip-recovery.test.ts',
      'tests/unit/dartline-temporal-evidence.test.ts',
    ):
      dst=root/rel
      dst.parent.mkdir(parents=True,exist_ok=True)
      shutil.copyfile(BASE/rel,dst)

    # Keep raw inference report truth until the publishing bridge: dropping
    # all off-board positives too early could turn them into fake [] takeouts.
    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS, type TemporalFrame } from '../../lib/temporalDartEvidence';",
      """import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS, type TemporalFrame } from '../../lib/temporalDartEvidence';
import { boardImpactRegion, strongNewPhysicalMiss, physicalBoardTipBatch, physicalBoardMask, scorePhysicalDart } from '../../lib/physicalBoardImpact';""")
    patch(scorer,
      "  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {",
      """  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {
    // Reject keypoints mapped outside the ACTUAL circular dartboard face.
    // An off-board false positive must NEVER become a fake empty takeout.
    const onBoard=physicalBoardTipBatch(tips);
    if(onBoard===null)return;
    tips=onBoard;""")
    patch(scorer,
      """      const guess=temporalDartTracker.current.observe(image,now);
      if(!guess)return;
      // This is a physical before/after dart-shaped change, not a model
      // hallucination. Request the soonest SAFE serialized model inference,
      // then its independently spaced confirmation, without scoring here.
      rapidVisualRecovery.current.newPhysicalDart(now);
      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current;
      if(!runtime?.camera.active || !frame?.result)return;
      // Both this picture and model inference use the same center-square
      // camera crop. Correct the lens before projecting through its matrix.
      const lens=sliderValueToLensK1(runtime.lensCalibration);
      const p=undistortNormalizedPoint([guess.x,guess.y],lens);
      const board=transformPoint(p,frame.result.homography);
      if(!board || !board.every(Number.isFinite))return;""",
      """      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current?.result?vision.frameRef.current:lastGoodPose.current;
      // Evaluate EVERY changed dart-shaped component against the physical
      // circular board instead of selecting a larger stored/wall dart first.
      // This also makes real near-wire/outer-board misses eligible.
      const lens=runtime?.camera.active
        ? sliderValueToLensK1(runtime.lensCalibration):0;
      const project=(gx:number,gy:number)=>{
        if(!frame?.result)return null;
        const p=undistortNormalizedPoint([gx,gy],lens);
        return transformPoint(p,frame.result.homography);
      };
      // Preserve the last settled baseline while board pose is temporarily lost.
      if(!runtime?.camera.active || !frame?.result)return;
      const guess=temporalDartTracker.current.observe(image,now,
        (gx,gy)=>{
          const point=project(gx,gy);
          return point!==null && boardImpactRegion(point[0],point[1])!=='outside';
        },ctx.dartsRecorded,visualBoardReturn.current.emptyReference);
      if(!guess || !runtime?.camera.active || !frame?.result)return;
      rapidVisualRecovery.current.newPhysicalDart(now,guess.obscured||guess.confidence<0.80);
      const board=project(guess.x,guess.y);
      if(!board || !board.every(Number.isFinite))return;""")
    patch(scorer,
      """      const radial=Math.hypot(x-500000,y-500000);
      const result=scoreFromBoardCoords(x,y);
      // On the black NUMBER/SURROUND ring, a good silhouette is evidence
      // of a new MISS even when the network's tip filter omitted it.
      // Require clear shaft shape, distant from the double wire, and a
      // stable before/after pair. Never auto-score an ambiguous hidden tip.
      if(result.label==='miss' && radial>425000 && radial<=500000
         && guess.confidence>=0.80 && !guess.obscured
         && guess.length>=35 && guess.area>=35){""",
      """      const result=scoreFromBoardCoords(x,y);
      // Outer annulus: 170mm double wire to 225mm board edge. Real *new*
      // physical dart-shaped image difference ONLY. No wall or static spare
      // darts; the independent low confidence guess remains manual.
      if(strongNewPhysicalMiss(x,y,guess)){""")

    # Takeout checks must exclude the very wall-mounted spares that scoring
    # filters out. Previously a spare outside the board could permanently
    # veto every empty-board inference, even when no playing darts remained.
    patch(scorer,
      "        const action=fastBoardClear.current.finish(token, Date.now(),\n          relaxed.tips.length ? 'occupied' : 'empty');",
      """        const onBoardTips=relaxed.tips.filter(t=>boardImpactRegion(t.x,t.y)!=='outside');
        const action=fastBoardClear.current.finish(token, Date.now(),
          onBoardTips.length ? 'occupied' : 'empty');""")
    patch(scorer,
      'try { latestOnTips.current(relaxed.tips,Math.round(frame.ms)); }',
      'try { latestOnTips.current(onBoardTips,Math.round(frame.ms)); }')

    # Motion recognition still ran expensive neural scans during retrieval
    # even though the publication guard discarded them. Keep the verifier
    # in charge of the only model calls during a full visit.
    runtime=root/'src/client/vision/visionRuntime.ts'
    patch(runtime,
      '  infer: () => Promise<BoardTip[]>;',
      """  infer: () => Promise<BoardTip[]>;
  setRetrieving: (retrieving:boolean)=>void;""")
    patch(runtime,
      '  let busy = false;',
      '  let busy = false;\n  let retrieving = false;')
    patch(runtime,
      '    onTrigger: () => { void infer(); },',
      '    onTrigger: () => { if(!retrieving)void infer(); },')
    patch(runtime,
      '    infer,\n    inferPositiveOnly:',
      '    infer,\n    setRetrieving: value => {retrieving=value;},\n    inferPositiveOnly:')
    patch(scorer,
      '        takeoutExclusive.current=enabled;\n        setTakeoutMonitorArmed(enabled);',
      '        takeoutExclusive.current=enabled;\n        vision.runtimeRef.current?.setRetrieving(enabled);\n        setTakeoutMonitorArmed(enabled);')

    # Geometry-qualified occlusion candidates go through a dedicated,
    # atomic server count/visit check rather than guessing another raw AI tip.
    patch(scorer,
      """      const result=scoreFromBoardCoords(x,y);
      // Outer annulus:""",
      """      const result=scoreFromBoardCoords(x,y);
      const physical=scorePhysicalDart(guess,project);
      if(physical && guess.recordedBefore===ctx.dartsRecorded &&
         ctx.dartsRecorded<3 && decodedFrameId!==null &&
         locatedVideoSource.current===stream &&
         lastLocatedAt.current>0 && now-lastLocatedAt.current<=12000){
        // Atomic visit/count prevents the normal AI and visual fallback
        // from both claiming the same arrival. Visible and hidden hits,
        // including the number ring, use the same independent pathway.
        latestOnTips.current([{x:physical.x,y:physical.y,confidence:guess.confidence,
          estimate:{visitKey:ctx.key,expectedCount:ctx.dartsRecorded}}],0);
        return;
      }
      // Outer annulus:""")
    patch(scorer,
      '    if(tips.length && !takeoutExclusive.current){',
      '    if(tips.length && !takeoutExclusive.current && !tips.some(t=>t.estimate)){')

    patch(scorer,
      '        temporalDartTracker.current.reset();\n        visualBoardReturn.current.reset();\n        photoTakeoutConfirm.current.reset();',
      '        temporalDartTracker.current.reset();\n        visualBoardReturn.current.startNextVisit();\n        fastBoardClear.current.reset();\n        takeoutScene.current.reset();\n        photoTakeoutConfirm.current.reset();')
    patch(scorer,
      '  const lastLocatedPhotoFrame = useRef<unknown>(null);',
      '  const lastLocatedPhotoFrame = useRef<unknown>(null);\n  const lastGoodPose=useRef<typeof vision.frameRef.current>(null);')
    patch(scorer,
      '        lastLocatedPhotoFrame.current=vision.frameRef.current;',
      '        lastLocatedPhotoFrame.current=vision.frameRef.current;\n        lastGoodPose.current=null;\n        temporalDartTracker.current.reset();')
    # Install the calibrated physical-board region once per visit, not once
    # per camera frame. Takeout still requires the occupied/empty sequence.
    patch(scorer,
      """          if(completed.result){
            locatedVisitKey.current=ctx.key;
            locatedVideoSource.current=video?.srcObject??null;
            lastLocatedAt.current=now;
          }""",
      """          if(completed.result){
            locatedVisitKey.current=ctx.key;
            locatedVideoSource.current=video?.srcObject??null;
            lastLocatedAt.current=now;
            lastGoodPose.current=completed;
            if(!visualBoardReturn.current.hasRegion && ctx.dartsRecorded===0){
              const runtime=vision.runtimeRef.current;
              if(runtime?.camera.active){
                const lens=sliderValueToLensK1(runtime.lensCalibration);
                const matrix=completed.result.homography;
                visualBoardReturn.current.setRegion(physicalBoardMask((x,y)=>
                  transformPoint(undistortNormalizedPoint([x,y],lens),matrix)));
              }
            }
          }""")

    types=root/'src/shared/vision/types.ts'
    patch(types,
      """export interface BoardTip {
  x: number;
  y: number;
  confidence: number;
}""",
      """export interface BoardTip {
  x: number;
  y: number;
  confidence: number;
  estimate?: {visitKey:string;expectedCount:number};
}""")
    shared=root/'src/shared/types.ts'
    patch(shared,
      '  winningConfidence: number;',
      """  winningConfidence: number;
  /** Shaft-based estimate rather than an observed point. */
  estimated?: boolean;""")

    tracker=root/'src/server/scoring/tracker.ts'
    patch(tracker,
      '  /** Forget the darts in the board.',
      """  /** Remember the accepted estimated point so a later AI sighting
   * cannot score it again. Called only after the match accepts the dart. */
  rememberEstimate(deviceId:string,tip:{x:number;y:number;confidence:number}):void {
    this.tracked.push({x:tip.x,y:tip.y,confidence:tip.confidence,
      observations:[{x:tip.x,y:tip.y,confidence:tip.confidence,deviceId}]});
  }

  /** Forget the darts in the board.""")
    session=root/'src/server/scoring/session.ts'
    patch(session,
      "import { DartTracker } from './tracker';",
      """import { DartTracker } from './tracker';
import { scoreFromBoardCoords } from '../../shared/scoring';
import {BOARD_CENTER,BOARD_MAX,boardRadii} from '../../shared/boardGeometry';""")
    patch(session,
      '  /** The whole camera roster, as the device registry currently sees it. */',
      """  /** A new physical shaft with a bounded hidden-tip estimate. Unlike a
   * regular batch, this is checked atomically against the live match and
   * accepted only for the exact pre-throw count. No replay or late AI race. */
  addEstimatedTip(deviceId:string,tip:BoardTip,key:string,expectedCount:number):boolean {
    if(!this.cameras.has(deviceId)||this.cameras.size!==1||
       !Number.isFinite(tip.x)||!Number.isFinite(tip.y)||!Number.isFinite(tip.confidence)||
       tip.confidence<.67||tip.confidence>1||
       Math.hypot(tip.x-BOARD_CENTER,tip.y-BOARD_CENTER)>boardRadii(BOARD_MAX).boardOuter)return false;
    this.syncVisit();
    const match=this.playableMatch();
    if(!match||key!==[match.id,match.legs.length,match.visits.length,match.currentPlayerIndex].join(':')
       ||!Number.isInteger(expectedCount)||expectedCount<0||expectedCount>2
       ||(match.currentVisit?.darts.length??0)!==expectedCount
       ||this.tracker.count!==expectedCount||match.currentVisit?.locked)return false;
    const playerId=this.scoringPlayerId(match);
    if(!playerId)return false;
    const outcome=addDartToMatch(match,playerId,{
      x:tip.x,y:tip.y,score:scoreFromBoardCoords(tip.x,tip.y),
      detection:{expectedScorers:1,reportingScorers:1,contributingScorers:1,
        winningScorer:this.opts.scorerLabel(deviceId),
        winningScorerId:this.opts.scorerId(deviceId),
        winningConfidence:tip.confidence,estimated:true},
    });
    if(!outcome.success||(outcome.match.currentVisit?.darts.length??0)!==expectedCount+1)
      return false;
    this.tracker.rememberEstimate(deviceId,tip);
    this.verifiedClear.reset();
    this.emptyCameras.clear();
    this.opts.commit(outcome.match);
    return true;
  }

  /** The whole camera roster, as the device registry currently sees it. */""")
    devices=root/'src/server/scoringDevices.ts'
    patch(devices,
      '  session.addTips(client.deviceId, tips);',
      """  const estimated=msg.tips.some((tip:any)=>tip?.estimate!==undefined);
  if(estimated){
    // Never let an invalid estimate fall through as an ordinary AI report.
    if(tips.length!==1)return;
    const e=msg.tips[0].estimate;
    if(!e||typeof e.visitKey!=='string'||e.visitKey.length>180||
       !Number.isInteger(e.expectedCount)||tips[0].confidence<0.67)return;
    session.addEstimatedTip(client.deviceId,tips[0],e.visitKey,e.expectedCount);
    return;
  }
  session.addTips(client.deviceId, tips);""")
    hud=root/'src/client/components/MobileMatchHUD.tsx'
    patch(hud,
      "<small>DART {i+1}{i<darts.length ? ' ✎' : ''}</small>",
      "<small>DART {i+1}{darts[i]?.detection?.estimated ? ' · EST.' : i<darts.length ? ' ✎' : ''}</small>")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v6.3-physical-event-recovery-RC\n',
      encoding='utf-8')
    print('DartLine v6 DRAFT physical board-only MISS recognition enabled')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as exc:
      print('v6 physical rim assembly failed:',exc,file=sys.stderr)
      sys.exit(1)
