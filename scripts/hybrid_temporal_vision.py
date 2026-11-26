#!/usr/bin/env python3
"""DartLine v5: a second, independent frame-difference recognition path.

Unlike thresholds around the original InstaDarts model, temporal vision
actually compares before/after camera pixels and can estimate a new shaft
when its tip is hidden. Guesses are clearly provisional and human-confirmable;
strong, unambiguous far-outside-the-score-ring MISS shapes can be scored as 0.

Verified retrieval uses prewarmed 48px hand motion OR settled physical return
to the EMPTY image from the start of the SAME visit. Both still require two
board-located empty model frames plus server owner/visit verification.
"""
from pathlib import Path
import shutil,sys

BASE=Path(__file__).resolve().parents[1]

def patch(p:Path,needle:str,replacement:str):
    text=p.read_text(encoding='utf-8')
    n=text.count(needle)
    if n!=1:raise RuntimeError(
        f'v5 integration changed at {p}: {needle[:90]!r} count={n}')
    p.write_text(text.replace(needle,replacement,1),encoding='utf-8')

def install(root:Path):
    for rel in (
        'src/client/lib/temporalDartEvidence.ts',
        'src/client/lib/visualBoardReturn.ts',
        'src/client/lib/takeoutSceneWitness.ts',
        'tests/unit/dartline-temporal-evidence.test.ts',
        'tests/unit/dartline-visual-board-return.test.ts',
        'tests/unit/dartline-takeout-scene-witness.test.ts',
    ):
        dst=root/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,dst)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { VisitTipEvidence } from '../../lib/visitTipEvidence';",
      """import { VisitTipEvidence } from '../../lib/visitTipEvidence';
import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS } from '../../lib/temporalDartEvidence';
import { VisualBoardReturn } from '../../lib/visualBoardReturn';
import { transformPoint } from '../../../shared/vision/homography';
import { sliderValueToLensK1, undistortNormalizedPoint } from '../../../shared/vision/lensDistortion';
import { scoreFromBoardCoords } from '../../../shared/scoring';""")
    patch(scorer,
      "  const idleTipRecovery = useRef(new IdleTipRecovery());",
      """  const idleTipRecovery = useRef(new IdleTipRecovery());
  const temporalDartTracker = useRef(new TemporalDartTracker());
  const visualBoardReturn = useRef(new VisualBoardReturn());
  const temporalCanvas = useRef<HTMLCanvasElement | null>(null);""")
    patch(scorer,
      """      if (old.key !== msg.key || (old.active && !msg.active)) idleTipRecovery.current.reset();""",
      """      if (old.key !== msg.key || (old.active && !msg.active)) {
        idleTipRecovery.current.reset();
        temporalDartTracker.current.reset();
        visualBoardReturn.current.reset();
      }""")

    # A separate 256px frame sampler runs continuously while the scoring
    # camera is active, INCLUDING after dart three. The original model is
    # unchanged and still executes on its own GPU/WASM pipeline.
    before="""  // One positive-only second look after a REAL motion trigger. Never"""
    inserted="""  // Physical scene-state evidence, independent of the original neural net.
  // Read small video frames without calling model.run or competing with
  // motion-triggered inference. No frames ever leave this browser.
  useEffect(() => {
    if (!scoring || !vision.cameraActive || view !== 'scoring') return;
    let disposed=false;
    const timer=window.setInterval(() => {
      if(disposed || !vision.runtimeRef.current?.camera.active)return;
      if(!temporalCanvas.current)
        temporalCanvas.current=document.createElement('canvas');
      const image=readTemporalCamera(vision.refs.video.current,temporalCanvas.current);
      if(!image)return;
      const now=Date.now(),ctx=visitContext.current;
      if(ctx.key && ctx.active && ctx.dartsRecorded<=3) {
        // Do not let the AI mistake a physically occupied board for empty.
        // A previously occupied camera image must return to its own empty
        // start-of-visit reference for >=650ms before this signal fires.
        if(visualBoardReturn.current.observe(image,ctx.dartsRecorded,now)
           && takeoutExclusive.current && ctx.dartsRecorded===3)
          fastBoardClear.current.noteRetrievalMotion();
      }
      if(takeoutExclusive.current || !ctx.active || ctx.dartsRecorded>=3
         || !ctx.key)return;
      const guess=temporalDartTracker.current.observe(image,now);
      if(!guess)return;
      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current;
      if(!runtime?.camera.active || !frame?.result)return;
      // Both this picture and model inference use the same center-square
      // camera crop. Correct the lens before projecting through its matrix.
      const lens=sliderValueToLensK1(runtime.lensCalibration);
      const p=undistortNormalizedPoint([guess.x,guess.y],lens);
      const board=transformPoint(p,frame.result.homography);
      if(!board || !board.every(Number.isFinite))return;
      const x=Math.round(board[0]),y=Math.round(board[1]);
      if(x<0||x>1000000||y<0||y>1000000)return;
      const radial=Math.hypot(x-500000,y-500000);
      const result=scoreFromBoardCoords(x,y);
      // On the black NUMBER/SURROUND ring, a good silhouette is evidence
      // of a new MISS even when the network's tip filter omitted it.
      // Require clear shaft shape, distant from the double wire, and a
      // stable before/after pair. Never auto-score an ambiguous hidden tip.
      if(result.label==='miss' && radial>425000 && radial<=500000
         && guess.confidence>=0.80 && !guess.obscured
         && guess.length>=35 && guess.area>=35){
        latestOnTips.current([{x,y,confidence:guess.confidence}],0);
        return;
      }
      // The shaft is visible but its metal point may be behind an existing
      // dart. Never pretend a one-camera estimate is ground truth. Offer
      // a one-tap, score-mapped estimate on the existing HUD instead.
      if(window.parent!==window)
        window.parent.postMessage({
          type:'dartline:temporal-guess', visitKey:ctx.key,
          x,y,label:result.label,confidence:guess.confidence,
          obscured:guess.obscured,
        },window.location.origin);
    },TEMPORAL_POLL_MS);
    return () => {disposed=true;window.clearInterval(timer);};
  },[scoring,vision.cameraActive,view,vision.refs.video,vision.runtimeRef,
     vision.frameRef]);

  // One positive-only second look after a REAL motion trigger. Never"""
    patch(scorer,before,inserted)

    # Prewarm hand-removal motion before the last score, so someone who
    # pulls quickly does not outrun the old post-third baseline capture.
    patch(scorer,
      """  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);""",
      """  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);
  const [takeoutMonitorPrepared, setTakeoutMonitorPrepared] = useState(false);""")
    patch(scorer,
      """        takeoutExclusive.current=enabled;
        setTakeoutMonitorArmed(enabled);""",
      """        takeoutExclusive.current=enabled;
        setTakeoutMonitorArmed(enabled);
        setTakeoutMonitorPrepared(event.data.prepare===true);""")
    patch(scorer,
      """  useEffect(() => {
    takeoutScene.current.reset();
    if (!takeoutMonitorArmed || !scoring || !vision.cameraActive) return;
    const timer=window.setInterval(() => {
      const video=vision.refs.video.current;
      if (!takeoutCanvas.current) takeoutCanvas.current=document.createElement('canvas');
      const gray=readTakeoutScene(video,takeoutCanvas.current);
      if (gray && takeoutScene.current.observe(gray,Date.now())) {
        fastBoardClear.current.noteRetrievalMotion();
      }
    },250);
    return () => window.clearInterval(timer);
  }, [takeoutMonitorArmed,scoring,vision.cameraActive,vision.refs.video]);""",
      """  useEffect(() => {
    // The camera sees the two-dart baseline BEFORE the third is registered.
    // Importantly, this effect does not depend on 'armed': changing 2 -> 3
    // does not reset the scene reference or lose an immediate hand movement.
    if (!takeoutMonitorPrepared || !scoring || !vision.cameraActive) {
      takeoutScene.current.reset();
      return;
    }
    const timer=window.setInterval(() => {
      const video=vision.refs.video.current;
      if (!takeoutCanvas.current)
        takeoutCanvas.current=document.createElement('canvas');
      const gray=readTakeoutScene(video,takeoutCanvas.current);
      if(gray && takeoutScene.current.observe(gray,Date.now(),
        takeoutExclusive.current))
        fastBoardClear.current.noteRetrievalMotion();
    },200);
    return () => window.clearInterval(timer);
  }, [takeoutMonitorPrepared,scoring,vision.cameraActive,vision.refs.video]);""")
    patch(scorer,
      """    fastBoardClear.current.arm(enabled, now,
      visitTipEvidence.current.seenDuringThisVisit);""",
      """    fastBoardClear.current.arm(enabled, now,
      visitTipEvidence.current.seenDuringThisVisit ||
      visitContext.current.dartsRecorded===3);""")

    # Early preparation remains disabled in the scorer until exactly THREE
    # scorecard darts are recorded. No privacy/side effects when option OFF.
    hud=root/'src/client/components/MobileMatchHUD.tsx'
    patch(hud,
      "import { textOf } from '../../shared/types';",
      "import { textOf } from '../../shared/types';\nimport { scoreFromBoardCoords } from '../../shared/scoring';")
    patch(hud,
      """  const monitorTakeout = autoTakeout && active && !remoteOpponent
    && match.status === 'in_progress' && darts.length === 3;""",
      """  const prepareTakeout = autoTakeout && active && !remoteOpponent
    && match.status==='in_progress' && darts.length>=2;
  const monitorTakeout = prepareTakeout && darts.length===3;""")
    patch(hud,
      "      detail:{armed:monitorTakeout},",
      "      detail:{armed:monitorTakeout,prepare:prepareTakeout},")
    patch(hud,
      "        detail:{armed:false},",
      "        detail:{armed:false,prepare:false},")
    patch(hud,
      "  },[monitorTakeout,match.id,match.currentPlayerIndex,match.visits.length]);",
      "  },[monitorTakeout,prepareTakeout,match.id,match.currentPlayerIndex,match.visits.length]);")

    # The turn key is derived from server match state (not a local guess).
    patch(hud,
      """  const ownsVisit = active && !remoteOpponent && match.status === 'in_progress';""",
      """  const ownsVisit = active && !remoteOpponent && match.status === 'in_progress';
  const [temporalGuess,setTemporalGuess] = useState<{
    x:number;y:number;label:string;confidence:number;
    visitKey:string;obscured:boolean;
  }|null>(null);
  useEffect(() => {
    const onGuess=(event:Event) => {
      const raw=(event as CustomEvent<any>).detail;
      if(!ownsVisit || !raw || raw.visitKey!==visitIdentity ||
         darts.length>=view.dartsPerVisit ||
         !Number.isFinite(raw.x)||!Number.isFinite(raw.y) ||
         raw.x<0||raw.x>1000000||raw.y<0||raw.y>1000000 ||
         typeof raw.confidence!=='number'||raw.confidence<0.45)return;
      const mapped=scoreFromBoardCoords(raw.x,raw.y);
      setTemporalGuess({x:raw.x,y:raw.y,
        label:mapped.label,confidence:raw.confidence,
        visitKey:raw.visitKey,obscured:raw.obscured===true});
    };
    window.addEventListener('dartline:temporal-guess',onGuess);
    return () => window.removeEventListener('dartline:temporal-guess',onGuess);
  },[ownsVisit,visitIdentity,darts.length,view.dartsPerVisit]);
  useEffect(()=>{setTemporalGuess(null);},[visitIdentity,darts.length]);""")

    patch(hud,
      """      <button type="button" className={'dartline-hud-auto-takeout '+(autoTakeout?'is-on':'')}""",
      """      {temporalGuess && active && canAddDart && darts.length<view.dartsPerVisit && (
        <div className="dartline-hud-temporal-guess" role="status">
          <strong>Camera saw a possible hidden or missed dart: {temporalGuess.label}</strong>
          <span>{temporalGuess.obscured
            ? 'Tip partly hidden: estimated from the newly visible shaft'
            : 'Estimated from the board change, not a confirmed AI tip'}</span>
          <div className="dartline-hud-temporal-actions">
            <Button size="xs" color="teal" onClick={()=>{
              onAddDart({x:temporalGuess.x,y:temporalGuess.y,
                score:scoreFromBoardCoords(temporalGuess.x,temporalGuess.y)});
              setTemporalGuess(null);
            }}>Use estimate</Button>
            <Button size="xs" variant="default" onClick={()=>setTemporalGuess(null)}>Dismiss</Button>
          </div>
        </div>
      )}
      <button type="button" className={'dartline-hud-auto-takeout '+(autoTakeout?'is-on':'')}""")

    dock=root/'src/client/components/PhoneCameraDock.tsx'
    patch(dock,
      "  const takeoutMonitor = useRef(false);",
      "  const takeoutMonitor = useRef(false);\n  const takeoutPrepared = useRef(false);")
    patch(dock,
      """      takeoutMonitor.current = Boolean((event as CustomEvent<{armed:boolean}>).detail?.armed);""",
      """      const takeoutDetail=(event as CustomEvent<{armed:boolean;prepare?:boolean}>).detail;
      takeoutMonitor.current=Boolean(takeoutDetail?.armed);
      takeoutPrepared.current=Boolean(takeoutDetail?.prepare);""")
    message="type:'dartline:takeout-monitor', armed:takeoutMonitor.current,"
    text=dock.read_text(encoding='utf-8')
    n=text.count(message)
    if n!=2:raise RuntimeError('Expected two iframe takeout handshakes; found '+str(n))
    dock.write_text(text.replace(message,
      "type:'dartline:takeout-monitor', armed:takeoutMonitor.current, prepare:takeoutPrepared.current,"),
      encoding='utf-8')
    patch(dock,
      """      if (data?.type === 'dartline:request-visit-context') {""",
      """      if (data?.type === 'dartline:temporal-guess') {
        if(typeof data.visitKey==='string'&&typeof data.x==='number'
           &&typeof data.y==='number'&&typeof data.confidence==='number')
          window.dispatchEvent(new CustomEvent('dartline:temporal-guess',{detail:data}));
        return;
      }
      if (data?.type === 'dartline:request-visit-context') {""")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v5-hybrid-temporal-vision-2026-11-26\n',encoding='utf-8')
    print('DartLine v5: temporal shaft guesses, safe exterior MISS scoring, prewarmed verified removal')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as e:
      print('DartLine v5 integration failed:',e,file=sys.stderr)
      sys.exit(1)
