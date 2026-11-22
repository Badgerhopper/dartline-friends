#!/usr/bin/env python3
"""Add DartLine's same-phone scorer to the pinned InstaDarts React application.

We deliberately do not touch the original model, motion detector, server protocol,
scoring or auth. A second same-origin scorer document owns its own WebSocket and
camera stream, just like a separately paired phone, but stays visible in the match
screen rather than losing camera access in a Safari background tab.
"""
from pathlib import Path
import shutil
import sys

BASE = Path(__file__).resolve().parents[1]

def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f"Unexpected upstream structure in {path}; match count={text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

def install(root: Path):
    component_dir = root / "src/client/components"
    lib_dir = root / "src/client/lib"
    for source, destination in (
        ("src/client/lib/phoneCamera.ts", lib_dir/"phoneCamera.ts"),
        ("src/client/components/PhoneCameraDock.tsx", component_dir/"PhoneCameraDock.tsx"),
        ("src/client/phoneCamera.css", root/"src/client/phoneCamera.css"),
        ("tests/unit/dartline-phone-camera.test.ts", root/"tests/unit/dartline-phone-camera.test.ts"),
    ):
        shutil.copyfile(BASE / source, destination)

    # Hidden pairing without opening the existing QR-code dialog.
    device_hook = root/"src/client/hooks/useScoringDevices.ts"
    replace(device_hook,
        "  const requestPairingCode = useCallback(() => {",
        """  /** Same-phone flow: mint the normal secure single-use code without showing a QR dialog. */
  const startInlinePairing = useCallback(() => {
    setPairing(false);
    setPairingCode(null);
    send({ type: 'create_pairing_code' });
  }, [send]);

  const requestPairingCode = useCallback(() => {""")
    replace(device_hook,
        "    startPairing,\n    requestPairingCode,",
        "    startPairing,\n    startInlinePairing,\n    requestPairingCode,")

    app = root/"src/client/App.tsx"
    replace(app,
        "import { HomePage } from './pages/HomePage';",
        """import { HomePage } from './pages/HomePage';
import { PhoneCameraDock } from './components/PhoneCameraDock';
import { loadPhoneCameraEnabled, savePhoneCameraEnabled } from './lib/phoneCamera';
import { loadIdentity, saveSettings as savePhoneSettings } from './lib/scorerStorage';""")

    replace(app,
        "  devicesHandler.current = devices.handleMessage;",
        """  devicesHandler.current = devices.handleMessage;

  // Same-phone mode: a visible, same-origin scorer iframe runs the original
  // camera/vision pipeline on its own socket while the main match stays mounted.
  const [phoneCameraEnabled, setPhoneCameraEnabled] = useState(loadPhoneCameraEnabled);
  // null = waiting for code; '' = resume known camera; code = new pairing.
  const [phonePairCode, setPhonePairCode] = useState<string | null>(null);
  const phonePairRequested = useRef(false);

  const useThisPhone = useCallback(() => {
    // A static cover over the small camera frame can obscure the stream.
    savePhoneSettings({ screensaver: false });
    savePhoneCameraEnabled(true);
    setPhoneCameraEnabled(true);
  }, []);

  const stopThisPhone = useCallback(() => {
    savePhoneCameraEnabled(false);
    setPhoneCameraEnabled(false);
    setPhonePairCode(null);
    phonePairRequested.current = false;
  }, []);

  const retryThisPhone = useCallback(() => {
    if (!connected) return;
    phonePairRequested.current = true;
    setPhonePairCode(null);
    devices.startInlinePairing();
  }, [connected, devices.startInlinePairing]);

  useEffect(() => {
    if (!phoneCameraEnabled || !connected || phonePairCode !== null || phonePairRequested.current) return;
    const local = loadIdentity();
    const previous = devices.devices.find((d) => d.deviceId === local?.deviceId);
    if (local && previous) {
      if (!previous.active) devices.grab(previous.deviceId);
      setPhonePairCode('');
    } else {
      phonePairRequested.current = true;
      devices.startInlinePairing();
    }
  }, [phoneCameraEnabled, connected, phonePairCode, devices.devices, devices.grab, devices.startInlinePairing]);

  useEffect(() => {
    if (!phoneCameraEnabled || !phonePairRequested.current || phonePairCode !== null) return;
    if (devices.pairingCode?.code) setPhonePairCode(devices.pairingCode.code);
  }, [phoneCameraEnabled, phonePairCode, devices.pairingCode]);

  const localPhoneId = loadIdentity()?.deviceId;
  const localPhoneDevice = devices.devices.find((d) => d.deviceId === localPhoneId);""")
    replace(app,
        "        boardCamera={boardCamera}\n        onBoardCameraChange={changeBoardCamera}\n      />",
        """        boardCamera={boardCamera}
        onBoardCameraChange={changeBoardCamera}
      />""")
    replace(app,
        "            onPairDevice={devices.startPairing}\n            unpaired={devices.devices.length === 0}",
        """            onPairDevice={devices.startPairing}
            onUsePhoneCamera={useThisPhone}
            phoneCameraEnabled={phoneCameraEnabled}
            unpaired={devices.devices.length === 0}""")
    replace(app,
        "      </AppShell.Main>\n      <MediaDebugPanel",
        """      </AppShell.Main>
      <PhoneCameraDock
        enabled={phoneCameraEnabled}
        connected={connected}
        code={phonePairCode}
        cameraActive={Boolean(localPhoneDevice?.online && localPhoneDevice.cameraActive)}
        cameraError={localPhoneDevice?.cameraError}
        inMatch={Boolean(match?.status === 'in_progress')}
        showLauncher={window.location.pathname !== '/'}
        onEnable={useThisPhone}
        onDisable={stopThisPhone}
        onRetry={retryThisPhone}
      />
      <MediaDebugPanel""")

    home = root/"src/client/pages/HomePage.tsx"
    replace(home,
        "  onPairDevice: () => void;",
        """  onPairDevice: () => void;
  onUsePhoneCamera: () => void;
  phoneCameraEnabled: boolean;""")
    replace(home,
        "  onPairDevice,\n  unpaired,",
        """  onPairDevice,
  onUsePhoneCamera,
  phoneCameraEnabled,
  unpaired,""")
    replace(home,
        "          {unpaired && (",
        """          {!phoneCameraEnabled && (
            <Button size="xl" color="teal" onClick={onUsePhoneCamera} disabled={!connected}>
              Use this iPhone as the scoring camera
            </Button>
          )}
          {unpaired && (""")
    replace(home,
        "              Pair a Scoring Device",
        "              Pair another scoring device")

    # Unlike importing as a global, load this only in the match frontend.
    main = root/"src/client/main.tsx"
    replace(main,
        "import './index.css';",
        "import './index.css';\nimport './phoneCamera.css';")
    dock = root/"src/client/components/PhoneCameraDock.tsx"
    replace(dock,
        "  cameraError?: string;",
        "  cameraError?: string;\n  showLauncher: boolean;")
    replace(dock,
        "  onEnable, onDisable, onRetry }: Props)",
        "  showLauncher, onEnable, onDisable, onRetry }: Props)")
    replace(dock,
        "  if (!enabled) {\n    return (",
        "  if (!enabled) {\n    if (!showLauncher) return null;\n    return (")

    # Update the separate scorer's language without changing its protocol/UI flow.
    scorer_join = root/"src/client/pages/scorer/JoinView.tsx"
    replace(scorer_join,
            "In InstaDarts, open the top bar and choose <em>Pair scoring device</em>.",
            "In DartLine, use the main screen's <em>Use this iPhone as the scoring camera</em> option, or pair a separate device from Cameras.")
    replace(home,
            "        <Text c=\"dimmed\" fz=\"lg\">Automatic darts scoring. Play live with your friends.</Text>",
            "        <Text c=\"dimmed\" fz=\"lg\">Automatic darts scoring. Play live with your friends.</Text>\n        <Text c=\"dimmed\" fz=\"sm\">Choose your phone camera, line up the board, then host or join a game.</Text>")

    print("DartLine same-phone setup installed.")

if __name__ == "__main__":
    try: install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print("Single-phone integration failed:", str(exc), file=sys.stderr)
        sys.exit(1)
