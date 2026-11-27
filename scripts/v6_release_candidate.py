#!/usr/bin/env python3
"""Unreleased v6 verification hardening.

No production deployment is authorized by this overlay. It upgrades v5.3's
photo verifier to require a genuinely newly decoded Safari video frame, a
recent board pose from the same camera stream, uninterrupted empty proof, and
finite retries. The server expires stale first-empty votes.

Model recognition, weights, camera-resolution settings and dart dedupe stay
untouched. This overlay must be CI-proven and real-device-tested separately.
"""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path:Path,before:str,after:str):
    code=path.read_text(encoding='utf-8')
    hits=code.count(before)
    if hits!=1:raise RuntimeError(
      f'v6 assembly mismatch at {path}: {before[:80]!r} count={hits}')
    path.write_text(code.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/videoFrameFreshness.ts',
      'tests/unit/dartline-video-frame-freshness.test.ts',
      'src/client/lib/photoTakeoutConfirm.ts',
      'tests/unit/dartline-photo-takeout-confirm.test.ts',
      'src/server/scoring/verifiedBoardClear.ts',
      'tests/unit/dartline-verified-board-clear.test.ts',
      'tests/unit/dartline-full-visit-integration.test.ts',
    ):
      dst=root/rel
      dst.parent.mkdir(parents=True,exist_ok=True)
      shutil.copyfile(BASE/rel,dst)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { PhotoTakeoutConfirm } from '../../lib/photoTakeoutConfirm';",
      """import { PhotoTakeoutConfirm } from '../../lib/photoTakeoutConfirm';
import { VideoFrameFreshness } from '../../lib/videoFrameFreshness';""")
    patch(scorer,
      """  const photoTakeoutConfirm = useRef(new PhotoTakeoutConfirm());
  const photoTakeoutPriority = useRef(false);
  const lastLocatedPhotoFrame = useRef<unknown>(null);
  const locatedVisitKey = useRef('');""",
      """  const photoTakeoutConfirm = useRef(new PhotoTakeoutConfirm());
  const photoTakeoutPriority = useRef(false);
  const freshVideoFrames = useRef(new VideoFrameFreshness());
  const observedCameraSource = useRef<MediaProvider|null>(null);
  const lastLocatedPhotoFrame = useRef<unknown>(null);
  const locatedVisitKey = useRef('');
  const locatedVideoSource = useRef<MediaProvider|null>(null);
  const lastLocatedAt = useRef(0);""")
    patch(scorer,
      """        locatedVisitKey.current='';
        pendingRemovalWitness.current.reset();""",
      """        locatedVisitKey.current='';
        locatedVideoSource.current=null;
        lastLocatedAt.current=0;
        pendingRemovalWitness.current.reset();""")

    patch(scorer,
      """      const now=Date.now(),ctx=visitContext.current;
      latestCameraSnapshot.current=image;""",
      """      const now=Date.now(),ctx=visitContext.current;
      const video=vision.refs.video.current;
      const stream=video?.srcObject??null;
      // iOS can replace the MediaStream without changing the <video> node.
      // All photo proof and homography from the old camera must be discarded.
      // A mid-turn camera change safely falls back to the AI verifier.
      if(stream!==observedCameraSource.current){
        observedCameraSource.current=stream;
        freshVideoFrames.current.stop();
        visualBoardReturn.current.reset();
        photoTakeoutConfirm.current.reset();
        lastLocatedPhotoFrame.current=null;
        lastLocatedAt.current=0;
        locatedVideoSource.current=null;
        locatedVisitKey.current='';
        photoTakeoutPriority.current=false;
      }
      // A timer tick does NOT prove a fresh camera frame. Safari can keep
      // serving the same last picture while its model/camera has stalled.
      const decodedFrameId=freshVideoFrames.current.sample(video,now);
      latestCameraSnapshot.current=image;""")
    patch(scorer,
      """          if(completed.result)locatedVisitKey.current=ctx.key;""",
      """          if(completed.result){
            locatedVisitKey.current=ctx.key;
            locatedVideoSource.current=video?.srcObject??null;
            lastLocatedAt.current=now;
          }""")
    patch(scorer,
      """        const allowed=Boolean(takeoutExclusive.current && scoring &&
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
        }""",
      """        const allowed=Boolean(takeoutExclusive.current && scoring &&
          vision.cameraActive && ctx.dartsRecorded===3 &&
          locatedVisitKey.current===ctx.key &&
          video?.srcObject && locatedVideoSource.current===video.srcObject &&
          lastLocatedAt.current>0 && now-lastLocatedAt.current<=12000 &&
          decodedFrameId!==null && document.visibilityState==='visible');
        const clear=allowed &&
          visualBoardReturn.current.matchesCurrentEmpty(image,ctx.dartsRecorded);
        // After the limited photo attempts, the existing model-based
        // verifier MUST get the camera again. No permanent starve/lockup.
        photoTakeoutPriority.current=clear &&
          photoTakeoutConfirm.current.hasBudget;
        if(!clear){
          // No partial photo confirmation survives an intervening obstructed
          // or occupied camera image or a missing decoded video frame.
          photoTakeoutConfirm.current.invalidate(ctx.key,now);
        } else if(photoTakeoutConfirm.current.claim(
            ctx.key,now,true,true,decodedFrameId)){
          // Two different decoded video frames, at least 900ms apart.
          // The server still requires two separately closed windows
          // and precisely three recorded darts in the assigned visit.
          allowVerifiedEmpty.current=true;
          try{latestOnTips.current([],0);}
          finally{allowVerifiedEmpty.current=false;}
        }""")
    patch(scorer,
      """    return () => {
      disposed=true;window.clearInterval(timer);
      photoTakeoutPriority.current=false;
    };""",
      """    return () => {
      disposed=true;window.clearInterval(timer);
      photoTakeoutPriority.current=false;
      freshVideoFrames.current.stop();
    };""")
    # NEVER auto-reset on rerenders from the 3-dart transition. The photo
    # reference and its clock both belong to the active camera+visit.

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v6-release-candidate-NOT-APPROVED\n',encoding='utf-8')
    print('DartLine v6 DRAFT: requires decoded-frame proof and short-lived server confirmations; NOT released')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as exc:
      print('v6 DRAFT assembly failed:',exc,file=sys.stderr);sys.exit(1)
