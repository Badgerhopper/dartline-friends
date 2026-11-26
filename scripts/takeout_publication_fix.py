#!/usr/bin/env python3
"""DartLine v5.1: eliminate competing positive AI reports during takeout.

A normal motion-triggered inference can report a phantom tip on an empty
board. During a verified 3-dart takeout, the server then resets its FIRST
empty-board confirmation before the SECOND arrived. A manual OFF/ON toggle
happened to clear state; it was not a solution.

ONLY the dedicated physical-removal verifier can publish reports while it
owns the board. It may publish verified empty frames or a genuine detected
occupied frame to cancel an invalid earlier vote. Outside takeout, the
entire existing DartLine v5 hybrid recognition pipeline is unchanged.

The detached iPhone camera iframe can also suspend a candidate inference;
the FastBoardClear watchdog now releases an uncompleted token rather than
requiring a manual toggle. A per-visit empty reference is frozen before the
first throw and not overwritten by delayed WebSocket score updates.
"""
from pathlib import Path
import shutil
import sys
BASE=Path(__file__).resolve().parents[1]

def patch(p:Path,before:str,after:str):
    text=p.read_text(encoding='utf-8')
    n=text.count(before)
    if n !=1:
        raise RuntimeError(f'v5.1 integration mismatch {p}: {before[:75]!r} count={n}')
    p.write_text(text.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
        'src/client/lib/takeoutPublication.ts',
        'tests/unit/dartline-takeout-publication.test.ts',
        'src/client/lib/fastBoardClear.ts',
        'tests/unit/dartline-fast-board-clear.test.ts',
        'src/client/lib/visualBoardReturn.ts',
        'tests/unit/dartline-visual-board-return.test.ts',
    ):
        dst=root/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,dst)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
       "import { FastBoardClear, FAST_CLEAR_TICK_MS } from '../../lib/fastBoardClear';",
       "import { FastBoardClear, FAST_CLEAR_TICK_MS } from '../../lib/fastBoardClear';\n"
       "import { mayPublishScorerTips } from '../../lib/takeoutPublication';")
    patch(scorer,
       """    if (tips.length === 0 && takeoutExclusive.current && !allowVerifiedEmpty.current) {
      return;
    }
    meter.current.onTipsReceived(tips.length > 0);""",
       """    // Scoring and verification are exclusive. Once 3 darts are recorded,
    // ordinary motion-triggered AI tips must not reset the SERVER's first
    // empty-board vote. ONLY an explicitly verified report may leave.
    if (!mayPublishScorerTips({
      takeoutExclusive:takeoutExclusive.current,
      explicitlyVerified:allowVerifiedEmpty.current,
    })) return;
    meter.current.onTipsReceived(tips.length > 0);""")
    patch(scorer,
       """        } else if (action==='send-occupied') {
          // Cancel an earlier empty vote with an actual observed tip.
          latestOnTips.current(relaxed.tips,Math.round(frame.ms));
        }""",
       """        } else if (action==='send-occupied') {
          // The dedicated verifier also owns POSITIVE reports: reset an
          // invalid pending empty vote only with fresh observed tips.
          allowVerifiedEmpty.current=true;
          try { latestOnTips.current(relaxed.tips,Math.round(frame.ms)); }
          finally {allowVerifiedEmpty.current=false;}
        }""")
    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v5.1-verified-takeout-isolation-2026-11-26\n',
      encoding='utf-8')
    print('DartLine v5.1: AI report isolation, stale inference watchdog, frozen empty-board reference')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as err:
        print('DartLine v5.1 integration failed:',err,file=sys.stderr)
        sys.exit(1)
