#!/usr/bin/env python3
"""DartLine v4.3: fix takeout across successive visits without lowering AI safety.

The last model frame may be an empty/missed frame just as the HUD records
a third dart. Preserve positive tip evidence seen EARLIER in the same visit.
Two accepted empty reports no longer cause the client to stop forever when
the server fails to advance; bounded rechecks require the original visual
retrieval witness AND fresh board-located model frames. Zero model thresholds
or geometry algorithms are changed.
"""
from pathlib import Path
import shutil
import sys

BASE=Path(__file__).resolve().parents[1]

def patch(path:Path,before:str,after:str):
    source=path.read_text(encoding='utf-8')
    n=source.count(before)
    if n!=1:
        raise RuntimeError(f'v4.3 source changed: {path} {before[:80]!r} x{n}')
    path.write_text(source.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/fastBoardClear.ts',
      'tests/unit/dartline-fast-board-clear.test.ts',
      'src/client/lib/visitTipEvidence.ts',
      'tests/unit/dartline-visit-tip-evidence.test.ts',
    ):
        dest=root/rel
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,dest)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { FastBoardClear, FAST_CLEAR_TICK_MS } from '../../lib/fastBoardClear';",
      "import { FastBoardClear, FAST_CLEAR_TICK_MS } from '../../lib/fastBoardClear';\n"
      "import { VisitTipEvidence } from '../../lib/visitTipEvidence';")
    patch(scorer,
      """  const takeoutExclusive = useRef(false);
  const allowVerifiedEmpty = useRef(false);""",
      """  const takeoutExclusive = useRef(false);
  const allowVerifiedEmpty = useRef(false);
  const visitTipEvidence = useRef(new VisitTipEvidence());""")
    patch(scorer,
      """    meter.current.onTipsReceived(tips.length > 0);
    setMeterSnapshot(meter.current.snapshot());""",
      """    // A tip observed earlier in THIS assigned visit proves the model saw
    // the darts, even if the last frame before takeout had no predictions.
    visitTipEvidence.current.observePositive(scoring, tips.length,
      takeoutExclusive.current);
    meter.current.onTipsReceived(tips.length > 0);
    setMeterSnapshot(meter.current.snapshot());""")
    patch(scorer,
      """      visitContext.current = {
        key:msg.key, active:msg.active, dartsRecorded:msg.dartsRecorded,
      };""",
      """      visitTipEvidence.current.updateVisit(msg.key,msg.active);
      visitContext.current = {
        key:msg.key, active:msg.active, dartsRecorded:msg.dartsRecorded,
      };""")
    patch(scorer,
      """    fastBoardClear.current.arm(enabled, now,
      Boolean(vision.frameRef.current?.result?.tips.length));""",
      """    // Do not let a single blank model frame at the third dart wipe
    // previous positive observations for THIS visit. Never use evidence
    // from a prior visit, an unassigned camera, or takeout inference.
    fastBoardClear.current.arm(enabled, now,
      visitTipEvidence.current.seenDuringThisVisit ||
      Boolean(vision.frameRef.current?.result?.tips.length));""")

    (root/'src/client/public/dartline-build.txt').write_text(
       'dartline-v4.3-reliable-repeat-visits-2026-11-26\n',encoding='utf-8')
    print('DartLine v4.3: visit-scoped tip baseline and bounded verified-clear retries installed')

if __name__=='__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('DartLine v4.3 integration failed:',error,file=sys.stderr)
        sys.exit(1)
