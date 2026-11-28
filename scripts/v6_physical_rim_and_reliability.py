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
import { boardImpactRegion, strongNewPhysicalMiss, physicalBoardTipBatch, physicalBoardMask, scorePhysicalDart, OuterMissConfirmation } from '../../lib/physicalBoardImpact';""")
    patch(scorer,
      "  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {",
      """  const outerMissConfirmation=useRef(new OuterMissConfirmation());
  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {
    // Reject keypoints mapped outside the ACTUAL circular dartboard face.
    // An off-board false positive must NEVER become a fake empty takeout.
    const onBoard=physicalBoardTipBatch(tips);
    if(onBoard===null)return;
    tips=onBoard;
    if(!takeoutExclusive.current&&!tips.some(t=>t.estimate)){
      const confirmed=outerMissConfirmation.current.filter(tips,scoringVisitKey.current,
        vision.frameRef.current,Date.now());
      if(confirmed===null){trace('Model MISS waiting for independent confirmation');return;}
      tips=confirmed;
    }""")
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
      if(!runtime?.camera.active || !frame?.result){trace('Physical scanner: waiting for board pose');return;}
      const guess=temporalDartTracker.current.observe(image,now,
        (gx,gy)=>{
          const point=project(gx,gy);
          return point!==null && boardImpactRegion(point[0],point[1])!=='outside';
        },ctx.dartsRecorded,visualBoardReturn.current.emptyReference);
      if(!guess || !runtime?.camera.active || !frame?.result){trace('Physical scanner: no settled shaft');return;}
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

    # Candidate scans must feed the same outer-miss gate even when the
    # idle tracker has not yet published a batch. Otherwise a weak real
    # MISS can exhaust its one emission before the second gate sees it.
    patch(scorer,
      '        const recovered=idleTipRecovery.current.observe(relaxed.tips,Date.now());',
      """        outerMissConfirmation.current.filter(relaxed.tips,initialVisit,frame,Date.now());
        const recoveryNow=Date.now();
        let recovered=idleTipRecovery.current.observe(relaxed.tips,recoveryNow);
        if(!recovered.length && relaxed.tips.length)
          recovered=idleTipRecovery.current.retryConfirmed(recoveryNow);""")

    # Takeout checks must exclude the very wall-mounted spares that scoring
    # filters out. Previously a spare outside the board could permanently
    # veto every empty-board inference, even when no playing darts remained.
    patch(scorer,
      "        const action=fastBoardClear.current.finish(token, Date.now(),\n          relaxed.tips.length ? 'occupied' : 'empty');",
      """        const onBoardTips=relaxed.tips.filter(t=>boardImpactRegion(t.x,t.y)!=='outside');
        const scanKind=onBoardTips.length?'occupied':'empty';
        if(visualBoardReturn.current.observeRemovalScan(frame.temporalPhoto??null,
          scanKind,visitContext.current.dartsRecorded,Date.now())){
          fastBoardClear.current.noteRetrievalMotion();
          trace('Takeout: actual shaft disappearance confirmed');
        }
        const action=fastBoardClear.current.finish(token, Date.now(),
          onBoardTips.length ? 'occupied' : 'empty');
        if(action==='send-empty' && fastBoardClear.current.emptyReportsSent===2 &&
           !onBoardTips.length){
          visualBoardReturn.current.rememberVotedEmpty(frame.temporalPhoto??null);
        }""")
    patch(scorer,
      'try { latestOnTips.current(relaxed.tips,Math.round(frame.ms)); }',
      'try { latestOnTips.current(onBoardTips,Math.round(frame.ms)); }')

    # Discard an in-flight verifier result if the owner advanced the visit
    # or Safari replaced the stream before inference completed.
    patch(scorer,
      """      const before=vision.frameRef.current;
      // Candidate-only inference:""",
      """      const before=vision.frameRef.current;
      const retrievalVisit=visitContext.current.key;
      const retrievalSource=vision.refs.video.current?.srcObject;
      // Candidate-only inference:""")
    patch(scorer,
      '        if (disposed || result===null || !frame || frame===before) {',
      """        if (disposed || result===null || !frame || frame===before ||
            retrievalVisit!==visitContext.current.key ||
            retrievalSource!==vision.refs.video.current?.srcObject ||
            visitContext.current.dartsRecorded!==3) {""")
    # Report only current-visit server status, rather than leaving
    # "submitting" visible indefinitely from an earlier successful round.
    session_status=root/'src/server/scoring/session.ts'
    patch(session_status,
      """    this.tracker.reset();
    this.verifiedClear.reset();
    this.consecutiveEmpty = 0;""",
      """    this.tracker.reset();
    this.verifiedClear.reset();
    this.takeoutReason=this.takeoutMode==='verified'
      ? 'Waiting for verified empty board' : 'Disabled';
    this.consecutiveEmpty = 0;""")
    patch(session_status,
      '  get verifiedTakeoutStatus() {',
      '  get verifiedTakeoutStatus() {\n    this.syncVisit();')

    # Carry the actual inference-time photo with the located result. The
    # next timer tick is not necessarily the picture the AI classified.
    runtime=root/'src/client/vision/visionRuntime.ts'
    patch(runtime,
      "import { InferenceErrorRecovery } from '../lib/inferenceErrorRecovery';",
      """import { InferenceErrorRecovery } from '../lib/inferenceErrorRecovery';
import {readTemporalCamera,type TemporalFrame} from '../lib/temporalDartEvidence';""")
    patch(runtime,
      'export type FrameInfo = {',
      'export type FrameInfo = {\n  temporalPhoto?:TemporalFrame|null;\n  photoCapturedAt?:number;')
    patch(runtime,
      '  function captureInputFrame() {',
      '  let evidenceCanvas:HTMLCanvasElement|null=null;\n  function captureInputFrame() {')
    patch(runtime,
      '      captureInputFrame();',
      """      captureInputFrame();
      let temporalPhoto:TemporalFrame|null=null;
      const photoCapturedAt=Date.now();
      try {
        if(!evidenceCanvas)evidenceCanvas=document.createElement('canvas');
        temporalPhoto=readTemporalCamera(video,evidenceCanvas);
      } catch { /* Optional photo evidence must never prevent model inference. */ }""")
    patch(runtime,
      '      onFrame({\n        keypoints,',
      '      onFrame({\n        temporalPhoto,\n        photoCapturedAt,\n        keypoints,')

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
      if(physical && (physical.label!=='miss'||strongNewPhysicalMiss(x,y,guess)) &&
         guess.recordedBefore===ctx.dartsRecorded &&
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
    # The old raw MISS branch bypassed the expected-count and provenance
    # safeguards. It is superseded by the atomic estimated-dart route.
    patch(scorer,
      """      if(strongNewPhysicalMiss(x,y,guess)){
        latestOnTips.current([{x,y,confidence:guess.confidence}],0);
        return;
      }""",
      """      // No unqualified zero can bypass the atomic physical hit route.""")
    patch(scorer,
      '    if(tips.length && !takeoutExclusive.current){',
      '    if(tips.length && !takeoutExclusive.current && !tips.some(t=>t.estimate)){')

    patch(scorer,
      '        temporalDartTracker.current.reset();\n        visualBoardReturn.current.reset();\n        photoTakeoutConfirm.current.reset();',
      '        temporalDartTracker.current.reset();\n        visualBoardReturn.current.startNextVisit();\n        temporalDartTracker.current.setRegion(visualBoardReturn.current.regionMask);\n        const nextReference=visualBoardReturn.current.emptyReference;\n        if(nextReference && msg.active && msg.dartsRecorded===0){\n          temporalDartTracker.current.prime(nextReference);\n          sceneGate.current.prime(msg.key,nextReference);\n        }\n        fastBoardClear.current.reset();\n        takeoutScene.current.reset();\n        photoTakeoutConfirm.current.reset();')
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
            if(!visualBoardReturn.current.hasRegion){
              const runtime=vision.runtimeRef.current;
              if(runtime?.camera.active){
                const lens=sliderValueToLensK1(runtime.lensCalibration);
                const matrix=completed.result.homography;
                const region=physicalBoardMask((x,y)=>
                  transformPoint(undistortNormalizedPoint([x,y],lens),matrix));
                visualBoardReturn.current.setRegion(region);
                temporalDartTracker.current.setRegion(region);
                sceneGate.current.setRegion(region);
              }
            }
            if(ctx.dartsRecorded>0 && completed.result.tips.some(t=>boardImpactRegion(t.x,t.y)!=='outside') &&
               !takeoutExclusive.current){
              visualBoardReturn.current.observeRemovalScan(completed.temporalPhoto??null,'occupied',
                ctx.dartsRecorded,now);
            }
            if(ctx.dartsRecorded===0&&!visualBoardReturn.current.hasEmptyReference){
              const runtime=vision.runtimeRef.current;
              const relaxed=runtime?recoverBoard(completed.keypoints,
                vision.settings.boardThreshold,Math.min(vision.settings.tipThreshold,RELAXED_TIP_THRESHOLD),
                runtime.lensCalibration):null;
              const empty=Boolean(relaxed&&!relaxed.tips.some(t=>boardImpactRegion(t.x,t.y)!=='outside'));
              if(visualBoardReturn.current.observeLocatedEmpty(completed.temporalPhoto??null,empty,now)){
                const reference=visualBoardReturn.current.emptyReference;
                if(reference)temporalDartTracker.current.prime(reference);
                trace('Empty board reference acquired from located AI frames');
              }
            }
          } else if(ctx.dartsRecorded===0){
            visualBoardReturn.current.observeLocatedEmpty(null,false,now);
          }""")
    patch(scorer,
      'visualBoardReturn.current.observe(image,ctx.dartsRecorded,now)',
      """visualBoardReturn.current.observe(image,ctx.dartsRecorded,now,true)""")
    patch(scorer,
      '        if(visualBoardReturn.current.observe(image,ctx.dartsRecorded,now,true)',
      """        if(ctx.dartsRecorded===0 && decodedFrameId!==null &&
           visualBoardReturn.current.finishInitialReference(image,now)){
          temporalDartTracker.current.prime(image);
          trace('Empty reference acquired from located scan and live video');
        }
        if(visualBoardReturn.current.observe(image,ctx.dartsRecorded,now,true)""")

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

    # Expose a compact local-only diagnostic history. No camera images or
    # device identity are sent to a telemetry service. If hardware differs
    # from the replay, the scoreboard can show exactly which gate is failing.
    patch(scorer,
      '  const lastLocatedAt = useRef(0);',
      '  const lastLocatedAt = useRef(0);\n  const cameraTrace=useRef<string[]>([]);\n  const trace=(message:string)=>{\n    const last=cameraTrace.current.at(-1);\n    if(last===message)return;\n    cameraTrace.current=[...cameraTrace.current.slice(-19),message];\n  };')
    patch(scorer,
      '      inferenceMs: Math.round(vision.frame?.ms ?? 0),',
      """      inferenceMs: Math.round(vision.frame?.ms ?? 0),
      cameraTrace: [
        'Scorer v6.4.1 | '+status+' | '+view,
        'Camera '+(vision.cameraActive?'on':'off')+' | scoring '+scoring,
        'Context '+(visitContext.current.key?'present':'MISSING')+
          ' | active '+visitContext.current.active+
          ' | count '+visitContext.current.dartsRecorded,
        'Takeout armed '+takeoutExclusive.current+
          ' | photo votes '+photoTakeoutConfirm.current.reportsSent+
          ' | model votes '+fastBoardClear.current.emptyReportsSent+
          ' | retrieval witness '+fastBoardClear.current.hasRetrievalWitness,
        'Board pose '+(lastLocatedAt.current?Math.round((Date.now()-lastLocatedAt.current)/1000)+'s old':'missing')+
          ' | empty reference '+visualBoardReturn.current.hasEmptyReference,
        ...cameraTrace.current.slice(-15)
      ],""")
    patch(scorer,
      '        photoTakeoutPriority.current=clear &&',
      """        if(ctx.dartsRecorded===3){
          trace('Takeout: '+(!takeoutExclusive.current?'not armed':
            !visualBoardReturn.current.hasEmptyReference?'no empty reference':
            !visualBoardReturn.current.hasSeenPhysicalDarts?'no occupied reference':
            decodedFrameId===null?'video frame unavailable':
            !allowed?'camera pose unavailable':
            !clear?'waiting for clear ('+(visualBoardReturn.current.changedFraction*100).toFixed(2)+'% changed)':
            'clear; votes '+photoTakeoutConfirm.current.reportsSent));
        }
        photoTakeoutPriority.current=clear &&""")
    patch(scorer,
      '      const physical=scorePhysicalDart(guess,project);',
      """      const physical=scorePhysicalDart(guess,project);
      trace('Dart: '+(physical?.label??'weak shape')+' quality '+guess.confidence.toFixed(2)
        +' '+(guess.obscured?'hidden':'visible')+' count '+guess.recordedBefore+'/'+ctx.dartsRecorded);""")
    patch(scorer,
      '        latestOnTips.current([{x:physical.x,y:physical.y,confidence:guess.confidence,',
      """        trace('Physical score sent: '+physical.label+' slot '+(ctx.dartsRecorded+1));
        latestOnTips.current([{x:physical.x,y:physical.y,confidence:guess.confidence,""")
    dock=root/'src/client/components/PhoneCameraDock.tsx'
    patch(dock,
      '        recoveryConfirmed: data.recoveryConfirmed,\n      }}));',
      """        recoveryConfirmed: data.recoveryConfirmed,
        cameraTrace: Array.isArray(data.cameraTrace)?data.cameraTrace.filter(
          (line:unknown)=>typeof line==='string').slice(-20):[],
      }}));""")
    health=root/'src/client/lib/cameraHealth.ts'
    patch(health,
      '  inferenceMs?:number;',
      '  inferenceMs?:number;\n  cameraTrace?:string[];')
    patch(hud,
      '      <div className="dartline-hud-slot-hint">',
      """      <details className="dartline-hud-slot-hint" style={{display:'block',textAlign:'left',padding:8}}>
        <summary>Camera Diagnostics · {cameraReport?.inferenceMs??0} ms AI</summary>
        <pre style={{whiteSpace:'pre-wrap',textAlign:'left',fontSize:12}}>{[
          'HUD v6.4.1 | local turn '+ownsVisit+' | darts '+darts.length+' | auto-submit '+autoTakeout,
          cameraReport?'Health received | scoring '+cameraReport.scoring:'No camera health received',
          ...(cameraReport?.cameraTrace?.length?cameraReport.cameraTrace:['No scorer trace received'])
        ].join('\\n')}</pre>
        <button type="button" onClick={()=>void navigator.clipboard?.writeText([
          'HUD v6.4.1 | local turn '+ownsVisit+' | darts '+darts.length+' | auto-submit '+autoTakeout,
          cameraReport?'Health received | scoring '+cameraReport.scoring:'No camera health received',
          ...(cameraReport?.cameraTrace??['No scorer trace received'])
        ].join('\\n')).catch(()=>{})}>Copy diagnostics</button>
      </details>
      <div className="dartline-hud-slot-hint">""")

    # A single explicit player-confirmed empty photo is a recovery path
    # if the automatic initial reference could not be established. Never
    # arm/submit a visit from this button. Keep all pixels inside the phone.
    patch(scorer,
      "      if (event.data?.type !== 'dartline:visit-context') return;",
      """      if(event.data?.type==='dartline:confirm-empty-reference'){
        const ctx=visitContext.current,now=Date.now();
        const image=latestCameraSnapshot.current;
        if(ctx.key===event.data.key && ctx.active && ctx.dartsRecorded===0 &&
           image && now-latestCameraAt.current<=750 &&
           lastLocatedAt.current>0 && now-lastLocatedAt.current<=12000 &&
           locatedVideoSource.current===vision.refs.video.current?.srcObject &&
           visualBoardReturn.current.confirmUserEmpty(image,0)){
          temporalDartTracker.current.prime(image);
          sceneGate.current.prime(ctx.key,image);
          trace('Empty board reference confirmed by player');
        } else trace('Empty reference not captured: need active zero-dart visit and located live camera');
        return;
      }
      if (event.data?.type !== 'dartline:visit-context') return;""")
    patch(scorer,
      '      cameraTrace: [',
      '      emptyReferenceReady: visualBoardReturn.current.hasEmptyReference,\n      cameraTrace: [')
    patch(dock,
      '        cameraTrace: Array.isArray(data.cameraTrace)?',
      '        emptyReferenceReady: data.emptyReferenceReady===true,\n        cameraTrace: Array.isArray(data.cameraTrace)?')
    patch(dock,
      "  const [report, setReport] = useState<ScorerReport | null>(null);",
      """  useEffect(()=>{
    const confirm=(event:Event)=>{
      const key=(event as CustomEvent<{key:string}>).detail?.key;
      if(key && key===currentVisit.current.key && currentVisit.current.active &&
         currentVisit.current.dartsRecorded===0)
        frame.current?.contentWindow?.postMessage({type:'dartline:confirm-empty-reference',key},window.location.origin);
    };
    window.addEventListener('dartline:confirm-empty-reference',confirm);
    return ()=>window.removeEventListener('dartline:confirm-empty-reference',confirm);
  },[]);
  const [report, setReport] = useState<ScorerReport | null>(null);""")
    patch(health,
      '  cameraTrace?:string[];',
      '  cameraTrace?:string[];\n  emptyReferenceReady?:boolean;')
    patch(hud,
      '      <details className="dartline-hud-slot-hint" style={{display:',
      """      {autoTakeout && ownsVisit && darts.length===0 && cameraReport?.emptyReferenceReady===false &&
        <div className="dartline-hud-slot-hint">
          <span>Empty-board reference not acquired. If the board is completely empty:</span>
          <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent(
            'dartline:confirm-empty-reference',{detail:{key:visitIdentity}}))}>
            Set empty-board reference
          </button>
        </div>}
      <details className="dartline-hud-slot-hint" style={{display:""")
    # One scene checkpoint for both recognition paths. The count
    # acknowledgment is the server's, not an inference or timeout.
    patch(scorer,
      '  VisualScoringDeduper, RapidVisualRecovery, RAPID_RECOVERY_POLL_MS,',
      '  VisualScoringDeduper, RapidVisualRecovery, ScoringSceneGate, RAPID_RECOVERY_POLL_MS,')
    patch(scorer,
      '  const visualScoringDeduper = useRef(new VisualScoringDeduper());',
      '  const visualScoringDeduper = useRef(new VisualScoringDeduper());\n  const sceneGate=useRef(new ScoringSceneGate());')
    patch(scorer,
      '    meter.current.onTipsReceived(tips.length > 0);',
      """    if(tips.length && !takeoutExclusive.current && visitContext.current.active){
      const ctx=visitContext.current;
      const estimated=tips.some(t=>t.estimate);
      const capturedAt=estimated?deferredEstimate.current?.at:vision.frameRef.current?.photoCapturedAt;
      if(!capturedAt||capturedAt<visitBoundaryAt.current){
        trace('Score suppressed: inference belongs to an earlier visit');return;
      }
      const photo=estimated?deferredEstimate.current?.photo??null:
        vision.frameRef.current?.temporalPhoto??null;
      if(!photo || !sceneGate.current.allow(ctx.key,ctx.dartsRecorded,tips,photo,Date.now())){
        trace('Score suppressed: same scene or awaiting score acknowledgment');return;
      }
    }
    meter.current.onTipsReceived(tips.length > 0);""")
    patch(scorer,
      '      scoringVisitKey.current=msg.active?msg.key:\'\';',
      """      scoringVisitKey.current=msg.active?msg.key:'';
      if(old.key!==msg.key||old.active!==msg.active)visitBoundaryAt.current=Date.now();
      const acknowledgedPhoto=sceneGate.current.acknowledge(msg.key,msg.dartsRecorded);
      if(acknowledgedPhoto)temporalDartTracker.current.prime(acknowledgedPhoto,msg.dartsRecorded);""")
    patch(scorer,
      '        lastGoodPose.current=null;',
      '        lastGoodPose.current=null;\n        sceneGate.current.reset();\n        sceneGate.current.setRegion(null);')
    # Temporal estimates must not race the actual AI. Instead preserve
    # their provisional arrival and allow the AI an independent opportunity
    # to score it. If count advances, discard this estimate.
    patch(scorer,
      '  const lastGoodPose=useRef<typeof vision.frameRef.current>(null);',
      """  const lastGoodPose=useRef<typeof vision.frameRef.current>(null);
  const deferredEstimate=useRef<{key:string;count:number;at:number;tip:BoardTip;photo:TemporalFrame}|null>(null);
  const visitBoundaryAt=useRef(0);""")
    patch(scorer,
      '        lastGoodPose.current=null;',
      '        lastGoodPose.current=null;\n        deferredEstimate.current=null;')
    patch(scorer,
      '        latestOnTips.current([{x:physical.x,y:physical.y,confidence:guess.confidence,\n          estimate:{visitKey:ctx.key,expectedCount:ctx.dartsRecorded}}],0);',
      """        deferredEstimate.current={key:ctx.key,count:ctx.dartsRecorded,at:now,photo:image,
          tip:{x:physical.x,y:physical.y,confidence:guess.confidence,
            estimate:{visitKey:ctx.key,expectedCount:ctx.dartsRecorded}}};""")
    patch(scorer,
      '      const runtime=vision.runtimeRef.current;\n      const frame=vision.frameRef.current?.result?vision.frameRef.current:lastGoodPose.current;',
      """      const pendingEstimate=deferredEstimate.current;
      if(pendingEstimate){
        if(pendingEstimate.key!==ctx.key || pendingEstimate.count!==ctx.dartsRecorded ||
           now-pendingEstimate.at>3000)deferredEstimate.current=null;
        else if(now-pendingEstimate.at>=700){
          latestOnTips.current([pendingEstimate.tip],0);
          // Retry only if the authoritative count has not moved. The shared
          // scene gate and server count check prevent a second acceptance.
        }
      }
      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current?.result?vision.frameRef.current:lastGoodPose.current;""")
    # The visit-context and takeout-monitor events can arrive in either
    # order. A reset can disarm the gate while React's boolean is already
    # true, so do not depend on a changed React state to arm it.
    patch(scorer,
      '      const token=fastBoardClear.current.claim(',
      """      const retrievalNow=Date.now(),ctx=visitContext.current;
      if(!ctx.active||ctx.dartsRecorded!==3)return;
      fastBoardClear.current.arm(true,retrievalNow,true);
      pendingRemovalWitness.current.replay(fastBoardClear.current,retrievalNow);
      const token=fastBoardClear.current.claim(""")
    patch(scorer,
      '        fastBoardClear.current.reset();\n        takeoutScene.current.reset();',
      """        fastBoardClear.current.reset();
        takeoutScene.current.reset();
        if(msg.active&&msg.dartsRecorded===3&&takeoutExclusive.current)
          fastBoardClear.current.arm(true,Date.now(),true);""")
    # Capture motion after count two even before the third score reaches
    # the scoreboard; only the gate can authorize submission after three.
    # Keep the existing prewarm-only hand motion policy. Actual removal
    # can be witnessed independently by the full resolution verifier.
    # Do not overwrite a freshly scored occupied image with an arbitrary
    # less-complete photo. Keep the most complete view for disappearance.
    # Initial calibration must be independent of the optional relaxed
    # detector: it often hallucinates a static wire/flight on a clear board.
    # Use the stricter successful inference plus stable photo proof.
    patch(scorer,
      "              const empty=Boolean(relaxed&&!relaxed.tips.some(t=>boardImpactRegion(t.x,t.y)!=='outside'));",
      """              const empty=Boolean(relaxed && !completed.result.tips.some(
                t=>boardImpactRegion(t.x,t.y)!=='outside'));""")
    patch(scorer,
      '                if(reference)temporalDartTracker.current.prime(reference);',
      '                if(reference){temporalDartTracker.current.prime(reference);sceneGate.current.prime(ctx.key,reference);}')
    patch(scorer,
      "          trace('Empty reference acquired from located scan and live video');",
      """          sceneGate.current.prime(ctx.key,image);
          trace('Empty reference acquired from located scan and live video');""")

    # A stale image cannot authorize an occupied-to-empty override. Require
    # the exact inference photo to still match the previously verified board.
    patch(scorer,
      """        const action=fastBoardClear.current.finish(token, Date.now(),
          onBoardTips.length ? 'occupied' : 'empty');""",
      """        if(onBoardTips.length && (!frame.temporalPhoto ||
            !visualBoardReturn.current.matchesCurrentEmpty(frame.temporalPhoto,3)))
          fastBoardClear.current.invalidatePhotoClear();
        const action=fastBoardClear.current.finish(token, Date.now(),
          onBoardTips.length ? 'occupied' : 'empty');""")
    # The wire count guard makes delayed ordinary model reports subject
    # to the same authoritative visit boundary as estimated hits.
    patch(types,
      '  estimate?: {visitKey:string;expectedCount:number};',
      '  estimate?: {visitKey:string;expectedCount:number};\n  visitGuard?: {visitKey:string;expectedCount:number};')
    patch(scorer,
      """        trace('Score suppressed: same scene or awaiting score acknowledgment');return;
      }
    }""",
      """        trace('Score suppressed: same scene or awaiting score acknowledgment');return;
      }
      if(!tips.some(t=>t.estimate)){
        tips=tips.map(t=>({...t,visitGuard:{visitKey:ctx.key,expectedCount:ctx.dartsRecorded}}));
      }
    }""")
    patch(session,
      '  /** A new physical shaft with a bounded hidden-tip estimate.',
      """  /** Count/visit validation for a regular model observation. A delayed
   * report from a previous throw cannot fill a second scoreboard slot. */
  addGuardedTips(deviceId:string,tips:BoardTip[],key:string,count:number):boolean {
    this.syncVisit();
    const match=this.playableMatch();
    if(!match||!this.cameras.has(deviceId)||!this.scoringPlayerId(match)||
       key!==[match.id,match.legs.length,match.visits.length,match.currentPlayerIndex].join(':')||
       !Number.isInteger(count)||count<0||count>2||
       (match.currentVisit?.darts.length??0)!==count||
       !tips.length||match.currentVisit?.locked)return false;
    this.addTips(deviceId,tips);
    return true;
  }

  /** A new physical shaft with a bounded hidden-tip estimate.""")
    patch(devices,
      """  session.addTips(client.deviceId, tips);""",
      """  const guarded=msg.tips.some((tip:any)=>tip?.visitGuard!==undefined);
  if(guarded){
    const g=msg.tips[0]?.visitGuard;
    if(!g||typeof g.visitKey!=='string'||g.visitKey.length>180||
       !Number.isInteger(g.expectedCount)||
       !msg.tips.every((tip:any)=>tip?.visitGuard?.visitKey===g.visitKey&&
         tip?.visitGuard?.expectedCount===g.expectedCount))return;
    session.addGuardedTips(client.deviceId,tips,g.visitKey,g.expectedCount);
    return;
  }
  session.addTips(client.deviceId, tips);""")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v6.4.1-acknowledged-recovery-RC\n',
      encoding='utf-8')
    print('DartLine v6 DRAFT physical board-only MISS recognition enabled')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as exc:
      print('v6 physical rim assembly failed:',exc,file=sys.stderr)
      sys.exit(1)
