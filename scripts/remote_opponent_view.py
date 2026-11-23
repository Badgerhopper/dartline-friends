#!/usr/bin/env python3
"""DartLine v2.5: automatically watch the remote board during the other player's turn.
The same code retains manual scoring in local matches and when a video feed fails."""
from pathlib import Path
import shutil
import sys

BASE = Path(__file__).resolve().parents[1]

def replace(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding='utf-8')
    if source.count(old) != 1:
        raise RuntimeError(f'Remote view overlay mismatch at {path}: {old[:90]!r}, got {source.count(old)}')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')

def install(root: Path) -> None:
    for rel in (
        'src/client/components/OpponentTurnView.tsx',
        'src/client/lib/remoteTurn.ts',
        'tests/unit/dartline-remote-turn.test.ts',
        'tests/unit/dartline-remote-view-render.test.tsx',
    ):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / rel, path)

    # mobile_experience.py built the iPhone match screen; targeted_correction.py
    # connected its new correction socket. Add the authoritative player roster
    # to the HUD only after those overlays have finished.
    page = root / 'src/client/pages/MatchScreen.tsx'
    replace(page,
        """          isMyTurn={isMyTurn}
          isSpectator={isSpectator}
          canAddDart={canAddDart}""",
        """          isMyTurn={isMyTurn}
          ownPlayerIds={ownPlayerIds}
          isSpectator={isSpectator}
          canAddDart={canAddDart}""")

    # The pinned upstream runner tests .ts only; our React render regression
    # checks are .tsx so explicitly include them in automated CI.
    replace(root / 'vitest.config.ts',
        "include: ['tests/unit/**/*.test.ts'],",
        "include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],")

    (root / 'src/client/public/dartline-build.txt').write_text(
        'dartline-remote-opponent-auto-view-v2.5-2026-11-23\n',
        encoding='utf-8',
    )
    print('DartLine v2.5 remote turn auto-view and safe board fallback installed')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('DartLine v2.5 overlay failed:', exc, file=sys.stderr)
        sys.exit(1)
