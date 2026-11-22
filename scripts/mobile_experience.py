#!/usr/bin/env python3
"""Install DartLine's mobile match controls and safer close-dart fusion.
Designed for the exact pinned InstaDarts revision from Dockerfile."""
from pathlib import Path
import shutil
import sys

BASE=Path(__file__).resolve().parents[1]

def replace(path: Path, original: str, new: str) -> None:
    src=path.read_text(encoding='utf-8')
    if src.count(original)!=1:
        raise RuntimeError(f'Unexpected upstream match for {path}: {original[:75]} ({src.count(original)})')
    path.write_text(src.replace(original,new,1),encoding='utf-8')

def install(root: Path):
    files=[
        ('src/client/components/MobileMatchHUD.tsx','src/client/components/MobileMatchHUD.tsx'),
        ('src/client/lib/manualCorrection.ts','src/client/lib/manualCorrection.ts'),
        ('src/client/mobileMatch.css','src/client/mobileMatch.css'),
        ('tests/unit/dartline-manual-correction.test.ts','tests/unit/dartline-manual-correction.test.ts'),
        ('tests/unit/dartline-close-darts.test.ts','tests/unit/dartline-close-darts.test.ts'),
    ]
    for src,dest in files:
        target=root/dest
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/src,target)

    page=root/'src/client/pages/MatchScreen.tsx'
    replace(page,
        "import { VisitInput } from '../components/VisitInput';",
        "import { VisitInput } from '../components/VisitInput';\nimport { MobileMatchHUD } from '../components/MobileMatchHUD';")
    replace(page,
        """  return (
    <ResponsiveBoxGrid
      key="match-live"
      profile="match-live"
      defaultLayouts={LIVE_MATCH_LAYOUTS}
      items={items}
    />
  );""",
        """  return (
    <>
      <div className="dartline-mobile-match">
        <MobileMatchHUD
          match={match}
          view={view}
          panel={panel}
          isMyTurn={isMyTurn}
          isSpectator={isSpectator}
          canAddDart={canAddDart}
          onLeave={onLeave}
          onAddDart={onAddDart}
          onUndoDart={onUndoDart}
          onSubmitVisit={onSubmitVisit}
          liveBoard={liveBoard}
          straightenVideo={straightenVideo}
          videoOffers={videoOffers}
          onAcceptVideo={onAcceptVideo}
          onDeclineVideo={onDeclineVideo}
        />
      </div>
      <div className="dartline-desktop-match">
        <ResponsiveBoxGrid
          key="match-live"
          profile="match-live"
          defaultLayouts={LIVE_MATCH_LAYOUTS}
          items={items}
        />
      </div>
    </>
  );""")

    main=root/'src/client/main.tsx'
    replace(main, "import './phoneCamera.css';",
        "import './phoneCamera.css';\nimport './mobileMatch.css';")

    cluster=root/'src/server/scoring/cluster.ts'
    replace(cluster,
        "      if (dist < THROW_WINDOW_DART_RADIUS && dist < nearestDist) {",
        """      // One camera reporting two distinct tip keypoints is evidence of two
      // different darts, not two cameras agreeing about one dart. Previous
      // clustering accidentally merged tight same-camera groups.
      if (!c.observations.some((o) => o.deviceId === tip.deviceId)
          && dist < THROW_WINDOW_DART_RADIUS && dist < nearestDist) {""")

    print('DartLine compact mobile match controls and close-dart fusion installed')

if __name__=='__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('Mobile UX integration failed:',exc,file=sys.stderr)
        sys.exit(1)
