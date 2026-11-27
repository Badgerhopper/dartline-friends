#!/usr/bin/env python3
"""DartLine v5.3: clear recovered AI errors, avoid duplicate image reads, use
new independent EMPTY photographs instead of expensive model inference to
submit after three server-confirmed darts.

Photo route is optional and safe: requires a stable before-throw empty photo,
physical occupied photo, a confirmed return to that same empty appearance,
a camera-local located board pose this visit, an active assigned player and
exactly three recorded darts. Two independently captured empty photos must
be separated by >=900ms before the server can submit. If any check fails, the
v5.1 verified model scanner remains unchanged as the fallback.

Never upload camera frames. No model changes, scoring thresholds or geometry.
"""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path:Path,before:str,after:str):
    s=path.read_text(encoding='utf-8')
    n=s.count(before)
    if n!=1: raise RuntimeError(f'v5.3 source mismatch {path}, {before[:94]!r}, n={n}')
    path.write_text(s.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/photoTakeoutConfirm.ts',
      'tests/unit/dartline-photo-takeout-confirm.test.ts',
      'src/client/lib/visualBoardReturn.ts',
      'tests/unit/dartline-visual-board-return.test.ts',
    ):
        out=root/rel
        out.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,out)

    hook=root/'src/client/hooks/useVisionRuntime.ts'
    patch(hook,
      """        setFrame(info);
        setScanCount((count) => count + 1);""",
      """        setFrame(info);
        // Temporary GPU/CPU inference failures must not keep the camera
        // permanently in an error state after a successful model frame.
        setError(previous => previous === null ? previous : null);
        setScanCount((count) => count + 1);""")

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { VisualBoardReturn } from '../../lib/visualBoardReturn';",
      """import { VisualBoardReturn } from '../../lib/visualBoardReturn';
import { PhotoTakeoutConfirm } from '../../lib/photoTakeoutConfirm';""")
    patch(scorer,
      "import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS } from '../../lib/temporalDartEvidence';",
      "import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS, type TemporalFrame } from '../../lib/temporalDartEvidence';")
    patch(scorer,
      """  const scoringComparisonCanvas = useRef<HTMLCanvasElement|null>(null);
  const scoringCameraVideo = useRef<HTMLVideoElement|null>(null);
  const scoringVisitKey = useRef('');""",
      """  // Share the EXISTING 256px camera snapshot with duplicate filtering.
  // An extra video draw/readback after every inference crowded the iPhone.
  const latestCameraSnapshot = useRef<TemporalFrame|null>(null);
  const latestCameraAt = useRef(0);
  const scoringVisitKey = useRef('');""")
    patch(scorer,
      """    if(tips.length && !takeoutExclusive.current && scoringCameraVideo.current){
      if(!scoringComparisonCanvas.current)
        scoringComparisonCanvas.current=document.createElement('canvas');
      const shot=readTemporalCamera(
        scoringCameraVideo.current,scoringComparisonCanvas.current);
      if(!visualScoringDeduper.current.shouldForward(
         scoringVisitKey.current,tips,shot,Date.now()))return;
    }""",
      """    if(tips.length && !takeoutExclusive.current){
      const when=Date.now();
      const recent=when-latestCameraAt.current<=900
        ? latestCameraSnapshot.current:null;
      // Absent a recent frame, defer to the existing server deduplicator
      // rather than dropping a potentially genuine score.
      if(!visualScoringDeduper.current.shouldForward(
         scoringVisitKey.current,tips,recent,when))return;
    }""")
    patch(scorer,
      """  // The onTips callback above is asynchronous. This ref gives it the live
  // frame without violating React hook order or starting a second camera.
  scoringCameraVideo.current=vision.refs.video.current;""",
      """  // Inference uses the camera runtime above; image dedupe shares snapshots
  // from the same lightweight temporal sampler below. No second readback.""")
    patch(scorer,
      """  const visualBoardReturn = useRef(new VisualBoardReturn());
  const pendingRemovalWitness = useRef(new PendingRemovalWitness());""",
      """  const visualBoardReturn = useRef(new VisualBoardReturn());
  const photoTakeoutConfirm = useRef(new PhotoTakeoutConfirm());
  const photoTakeoutPriority = useRef(false);
  const lastLocatedPhotoFrame = useRef<unknown>(null);
  const locatedVisitKey = useRef('');
  const pendingRemovalWitness = useRef(new PendingRemovalWitness());""")
    patch(scorer,
      """        visualBoardReturn.current.reset();
        pendingRemovalWitness.current.reset();""",
      """        visualBoardReturn.current.reset();
        photoTakeoutConfirm.current.reset();
        photoTakeoutPriority.current=false;
        locatedVisitKey.current='';
        pendingRemovalWitness.current.reset();""")

    patch(scorer,
      """      const image=readTemporalCamera(vision.refs.video.current,temporalCanvas.current);
      if(!image)return;
      const now=Date.now(),ctx=visitContext.current;
      if(ctx.key && ctx.active && ctx.dartsRecorded<=3) {
        // Do not let the AI mistake a physically occupied board for empty.
        // A previously occupied camera image must return to its own empty
        // start-of-visit reference for >=650ms before this signal fires.
        if(visualBoardReturn.current.observe(image,ctx.dartsRecorded,now)
           && takeoutExclusive.current && ctx.dartsRecorded===3) {
          pendingRemovalWitness.current.sawPhotoClear(now);
          fastBoardClear.current.noteVisualClear(now);
        }
      }""",
      """      const image=readTemporalCamera(vision.refs.video.current,temporalCanvas.current);
      if(!image)return;
      const now=Date.now(),ctx=visitContext.current;
      latestCameraSnapshot.current=image;
      latestCameraAt.current=now;
      if(ctx.key && ctx.active && ctx.dartsRecorded<=3) {
        // Only a fresh inference frame from THIS visit may supply geometry.
        const completed=vision.frameRef.current;
        if(completed && completed!==lastLocatedPhotoFrame.current){
          lastLocatedPhotoFrame.current=completed;
          if(completed.result)locatedVisitKey.current=ctx.key;
        }
        // Require an empty BEFORE photo, physically occupied intermediary,
        // and >=650ms settled clear AFTER photo. Never infer "empty" merely
        // because the neural network didn't see a dart.
        if(visualBoardReturn.current.observe(image,ctx.dartsRecorded,now)
           && takeoutExclusive.current && ctx.dartsRecorded===3) {
          pendingRemovalWitness.current.sawPhotoClear(now);
          fastBoardClear.current.noteVisualClear(now);
        }
        const allowed=Boolean(takeoutExclusive.current && scoring &&
          vision.cameraActive && ctx.dartsRecorded===3 &&
          locatedVisitKey.current===ctx.key);
        const clear=allowed &&
          visualBoardReturn.current.matchesCurrentEmpty(image,ctx.dartsRecorded);
        photoTakeoutPriority.current=clear;
        if(clear && photoTakeoutConfirm.current.claim(ctx.key,now,true,true)){
          // Publish ONLY independent physically verified empty camera frames.
          // The original scoring-session server still requires two
          // independent windows >=750ms apart and exactly three darts.
          allowVerifiedEmpty.current=true;
          try {latestOnTips.current([],0);}
          finally {allowVerifiedEmpty.current=false;}
        }
      } else {
        photoTakeoutPriority.current=false;
      }""")
    patch(scorer,
      """    return () => {disposed=true;window.clearInterval(timer);};
  },[scoring,vision.cameraActive,view,vision.refs.video,vision.runtimeRef,
     vision.frameRef]);""",
      """    return () => {
      disposed=true;window.clearInterval(timer);
      photoTakeoutPriority.current=false;
    };
  },[scoring,vision.cameraActive,view,vision.refs.video,vision.runtimeRef,
     vision.frameRef]);""")
    patch(scorer,
      """      if (disposed || !takeoutExclusive.current) return;
      const runtime=vision.runtimeRef.current;
      const token=fastBoardClear.current.claim(""",
      """      // Strong physical photo proof has its own independent, spaced
      // no-model confirmation path. Do not compete with it by running
      // 960/1280px neural network inference on an already empty board.
      if (disposed || !takeoutExclusive.current ||
          photoTakeoutPriority.current) return;
      const runtime=vision.runtimeRef.current;
      const token=fastBoardClear.current.claim(""")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v5.3-camera-recovery-photo-submit-2026-11-26\n',encoding='utf-8')
    print('DartLine v5.3: successful AI clears error, shared video pixels, photo-only two-frame takeout')
if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as err:
        print('v5.3 integration failed:',err,file=sys.stderr)
        sys.exit(1)
