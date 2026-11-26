#!/usr/bin/env python3
"""Undo v3.2's forced iPhone resolution downgrade, not tip recognition.

v3.2 lowered previously selected 1280-resolution board inference to 960
pixels. That can prevent board landmarks from being found at all. This only
recovers the prior resolution for phones carrying the exact downgrade marker.
The conservative v4 tip-rescue detector is not modified.
"""
from pathlib import Path
import shutil
import sys

BASE = Path(__file__).resolve().parents[1]

def install(root: Path) -> None:
    for name in ('src/client/lib/classicModel.ts',
                 'tests/unit/dartline-classic-model.test.ts'):
        dest = root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / name, dest)

    path = root / 'src/client/hooks/useVisionRuntime.ts'
    source = path.read_text(encoding='utf-8')
    before = "import { createVisionRuntime, MODELS } from '../vision/visionRuntime';"
    after = before + "\nimport { shouldRecoverBoardDetail } from '../lib/classicModel';"
    if source.count(before) != 1:
        raise RuntimeError('Could not locate vision-runtime import')
    source = source.replace(before, after, 1)

    before = "    const stored = loadSettings();\n    const runtime = createVisionRuntime({"
    after = """    let stored = loadSettings();
    // Recover the previously working board-detail setting exactly once.
    // This runs at camera initialization before the inference runtime starts.
    try {
      const key = 'dartline_restore_high_detail_v3_3';
      const previous = localStorage.getItem('dartline_high_detail_choice_v1');
      const downgraded = localStorage.getItem('dartline_restore_v4_model_v1');
      if (shouldRecoverBoardDetail(
        stored.model, navigator.userAgent, previous, downgraded,
        localStorage.getItem(key),
        Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
      )) {
        stored = saveSettings({ model: 's_1280' });
        setSettings(stored);
        localStorage.setItem(key, 'done');
      }
    } catch { /* Camera must work even when localStorage is unavailable. */ }
    const runtime = createVisionRuntime({"""
    if source.count(before) != 1:
        raise RuntimeError('Could not locate vision-runtime settings initialization')
    path.write_text(source.replace(before, after, 1), encoding='utf-8')
    print('Restored 1280 board inference on affected v3.2 iPhones; tip detector unchanged')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('Board model recovery overlay failed:', error, file=sys.stderr)
        sys.exit(1)
