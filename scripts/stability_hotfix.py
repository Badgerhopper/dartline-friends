#!/usr/bin/env python3
"""DartLine v2.7: stop false phantom throws, stabilize same-dart identity,
and make optional retrieval submission request full, motion-gated scans."""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path,needle,replacement):
    source=path.read_text(encoding='utf8')
    if source.count(needle)!=1:
        raise RuntimeError(f'v2.7 source mismatch {path}: {needle[:80]!r} ({source.count(needle)})')
    path.write_text(source.replace(needle,replacement,1),encoding='utf8')
def install(root):
    for rel in [
      'src/client/lib/tipRescue.ts',
      'tests/unit/dartline-tip-rescue.test.ts',
      'src/client/lib/stabilityScan.ts',
      'tests/unit/dartline-stability-scan.test.ts',
      'tests/unit/dartline-stability-cluster.test.ts',
      'src/client/components/MobileMatchHUD.tsx',
      'src/client/components/PhoneCameraDock.tsx',
    ]:
        destination=root/rel
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,destination)
    shutil.copyfile(BASE/'src/server/scoring/stabilityCluster.ts.txt',
                    root/'src/server/scoring/cluster.ts')

    runtime=root/'src/client/vision/visionRuntime.ts'
    patch(runtime,
       "      onFrame(\u007b\n        keypoints,",
       """      // A strict or weak tip beyond the scored double ring could be a genuine
      // miss, but without positive motion/location evidence it is mostly noise.
      // Disable auto-registering out-of-ring hits until tested on real boards.
      // Actual misses remain available via manual MISS input.
      if (result) {
        const scoringRadius = 170 * (1_000_000 / 451);
        result = { ...result, tips: result.tips.filter(tip =>
          Math.hypot(tip.x-500000,tip.y-500000) <= scoringRadius) };
      }
      onFrame({
        keypoints,""")
    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { ASSIST_INTERVAL_MS, shouldScanStationaryBoard } from '../../lib/scanAssist';",
      "import { ASSIST_INTERVAL_MS, shouldScanStationaryBoard } from '../../lib/scanAssist';\nimport { MotionRescueBudget, shouldProbeTakeout } from '../../lib/stabilityScan';")
    patch(scorer,
      "  const prevDot = useRef(vision.motion.dot);",
      "  const lastPhysicalMotionAt=useRef(0);\n  const rescueBudget=useRef(new MotionRescueBudget());\n  const prevDot = useRef(vision.motion.dot);")
    patch(scorer,
      "    if (!isPending) return;",
      "    if (isPending) lastPhysicalMotionAt.current=Date.now();\n    if (!isPending) return;")
    patch(scorer,
      """      })) return;
      void vision.runtimeRef.current?.inferPositiveOnly();
    }, ASSIST_INTERVAL_MS);""",
      """      })) return;
      // Background inference every 550ms with no throw caused phantom MISS
      // and duplicate S3 detections. Only rescue right after physical motion.
      if (!rescueBudget.current.allow(Date.now(),lastPhysicalMotionAt.current)) return;
      if (vision.motion.dot==='pending' || vision.motion.dot==='pendingLarge') return;
      void vision.runtimeRef.current?.inferPositiveOnly();
    }, ASSIST_INTERVAL_MS);""")
    patch(scorer,
      "  }, [scoring, vision.cameraActive, vision.motion.armed, vision.runtimeRef, view]);",
      "  }, [scoring, vision.cameraActive, vision.motion.armed, vision.runtimeRef, view, vision.motion.dot]);")
    source=scorer.read_text(encoding='utf8')
    start='  const boardClearProbes=useRef({sawDarts:false, remaining:0});'
    after='  // Rescue recognition: on some phones, a small dart impact does not move enough'
    if source.count(start)!=1 or source.count(after)!=1:
        raise RuntimeError('Missing v2.6 takeout-monitor code for replacement')
    before,tail=source.split(start,1)
    _,afterText=tail.split(after,1)
    monitor="""  // The host sends this only after it owns all three entered darts and the
  // player has opted into removal submission. A newly loaded iframe receives
  // the current preference again when it reports camera health.
  const [takeoutMonitorArmed,setTakeoutMonitorArmed]=useState(false);
  const removalMotionAt=useRef(0);
  useEffect(()=>{
    if(window.parent===window) return;
    const receive=(event:MessageEvent)=>{
      if(event.origin!==window.location.origin || event.source!==window.parent)return;
      if(event.data?.type==='dartline:takeout-monitor')
        setTakeoutMonitorArmed(event.data.armed===true);
    };
    window.addEventListener('message',receive);
    return ()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    if(!takeoutMonitorArmed || !scoring){
      removalMotionAt.current=0; return;
    }
    if(vision.motion.dot==='pending' || vision.motion.dot==='pendingLarge')
      removalMotionAt.current=Date.now();
  },[takeoutMonitorArmed,scoring,vision.motion.dot]);

  useEffect(()=>{
    if(!takeoutMonitorArmed || !scoring || !vision.cameraActive || !vision.motion.armed)
      return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState!=='visible') return;
      if(!shouldProbeTakeout(Date.now(),removalMotionAt.current,
          takeoutMonitorArmed,vision.motion.dot))return;
      // Unlike the positive-only backup scanner, full inference sends
      // homography-confirmed empty frames to the server. Its independent
      // confirmation gate and per-board permission still decide submission.
      void vision.runtimeRef.current?.infer();
    },1100);
    return ()=>window.clearInterval(timer);
  },[takeoutMonitorArmed,scoring,vision.cameraActive,vision.motion.armed,
    vision.motion.dot,vision.runtimeRef]);

"""
    scorer.write_text(before+monitor+after+afterText,encoding='utf8')
    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-phantom-fix-verified-clear-v2.7-2026-11-25\n',encoding='utf8')
    print('DartLine v2.7 motion-gated rescue, stable tracking and verified clear monitor installed')
if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('DartLine v2.7 integration failed:',exc,file=sys.stderr)
        sys.exit(1)
