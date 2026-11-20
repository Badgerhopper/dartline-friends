#!/usr/bin/env python3
"""Apply DartLine branding/game modes to an exact upstream InstaDarts checkout."""
import json
import pathlib
import shutil
import sys
BASE = pathlib.Path(__file__).resolve().parents[1]

def replace(path, old, new):
    s = path.read_text(encoding='utf-8')
    if new in s: return
    if old not in s: raise RuntimeError('Upstream changed: cannot patch ' + str(path) + ' (expected ' + repr(old) + ')')
    path.write_text(s.replace(old, new, 1), encoding='utf-8')

def run(root):
    package = json.loads((root/'package.json').read_text())
    if package.get('name') != 'instadarts': raise RuntimeError('Unexpected upstream package')
    if 'GNU AFFERO GENERAL PUBLIC LICENSE' not in (root/'LICENSE').read_text(): raise RuntimeError('AGPL license missing')
    modes = root/'src/server/modes'
    for name in ('cricket.ts', 'around-the-clock.ts'):
        shutil.copyfile(BASE/'src/server/modes'/name, modes/name)
    registry = modes/'registry.ts'
    s = registry.read_text()
    for name in ('cricket', 'around-the-clock'):
        line = "import './"+name+".js';"
        if line not in s:
            if "import './x01.js';" not in s: raise RuntimeError('Unrecognized registry')
            s = s.replace("import './x01.js';", "import './x01.js';\n"+line, 1)
    registry.write_text(s)
    wordmark = root/'src/client/components/Wordmark.tsx'
    s = wordmark.read_text()
    if 'InstaDarts' not in s and 'DartLine' not in s: raise RuntimeError('Unknown upstream wordmark')
    wordmark.write_text(s.replace('InstaDarts','DartLine'))
    home = root/'src/client/pages/HomePage.tsx'
    replace(home, 'Open Source AI darts scoring app.', 'Automatic darts scoring. Play live with your friends.')
    replace(home, '>Online Match</Button>', '>Host Friends Game</Button>')
    replace(home, '>Join Online Match</Button>', '>Join Friends Game</Button>')
    replace(home, 'title="InstaDarts Links"', 'title="Open-source credits and help"')
    html = root/'src/client/index.html'
    replace(html, '<title>InstaDarts</title>', '''<title>DartLine · Friends Darts</title>
    <meta name="theme-color" content="#101827" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="DartLine" />
    <link rel="manifest" href="/dartline.webmanifest" />''')
    public = root/'src/client/public'
    public.mkdir(exist_ok=True, parents=True)
    (public/'dartline.webmanifest').write_text(json.dumps({
        'name': 'DartLine Friends', 'short_name':'DartLine', 'start_url':'/', 'scope':'/',
        'display':'standalone', 'background_color':'#101827', 'theme_color':'#101827',
        'icons':[{'src':'/dartline-icon.svg','sizes':'any','type':'image/svg+xml','purpose':'any'}]
    }))
    shutil.copyfile(BASE/'dartline-icon.svg', public/'dartline-icon.svg')
    shutil.copyfile(BASE/'DARTLINE_NOTICE.md', root/'DARTLINE_NOTICE.md')
    print('DartLine overlay installed')
if __name__ == '__main__':
    try: run(pathlib.Path(sys.argv[1]).resolve())
    except Exception as exc: print('DartLine install error:', exc, file=sys.stderr); sys.exit(1)
