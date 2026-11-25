#!/usr/bin/env python3
"""Reset only the persisted v5 iPhone auto-upgrade once.
The original v4 model, motion detection and tip-tracking code stay unchanged.
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
    after = before + "\nimport { shouldRestoreClassicModel } from '../lib/classicModel';"
    if source.count(before) != 1:
        raise RuntimeError('Could not locate vision-runtime import')
    source = source.replace(before, after, 1)

    before = "    const stored = loadSettings();\n    const runtime = createVisionRuntime({"
    after = """    let stored = loadSettings();
    // The old 1280px model chosen by v5 persists even when its source code is
    // rolled back. Revert that one-time automatic choice so v4 runs at 960px.
    try {
      const rollbackKey = 'dartline_restore_v4_model_v1';
      if (shouldRestoreClassicModel(
        stored.model, navigator.userAgent,
        localStorage.getItem('dartline_high_detail_choice_v1'),
        localStorage.getItem(rollbackKey))) {
        stored = saveSettings({ model: 's_960' });
        setSettings(stored);
      }
      localStorage.setItem(rollbackKey, 'done');
    } catch { /* Storage may be disabled; keep the camera operational. */ }
    const runtime = createVisionRuntime({"""
    if source.count(before) != 1:
        raise RuntimeError('Could not locate vision-runtime settings initialization')
    path.write_text(source.replace(before, after, 1), encoding='utf-8')
    print('Restored pre-v5 iPhone model choice once; detector unchanged')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('Classic model rollback failed:', error, file=sys.stderr)
        sys.exit(1)
