#!/usr/bin/env python3
"""Atomic targeted dart correction and mobile board / camera reliability patch."""
from pathlib import Path
import shutil, sys
BASE=Path(__file__).resolve().parents[1]
def replace(path, old, new):
    content=path.read_text(encoding='utf-8')
    if content.count(old)!=1:
        raise RuntimeError(f'Correction overlay mismatch at {path}: {old[:85]!r}, found {content.count(old)}')
    path.write_text(content.replace(old,new,1),encoding='utf-8')
def patch(root):
    for rel in (
        'src/client/components/MobileMatchHUD.tsx',
        'src/client/mobileMatch.css',
        'src/client/phoneCamera.css',
        'src/client/lib/manualCorrection.ts',
        'tests/unit/dartline-specific-correction.test.ts',
    ):
        target=root/rel
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,target)

    protocol=root/'src/shared/protocol.ts'
    replace(protocol,
        """export interface UndoDartMessage {
  type: 'undo_dart';
}""",
        """export interface UndoDartMessage {
  type: 'undo_dart';
}

/** Replace one still-pending dart by its server-issued id, without changing the others. */
export interface CorrectDartMessage {
  type: 'correct_dart';
  index: number;
  expectedDartId: string;
  dart: DartThrow;
}""")
    replace(protocol,
        "  | UndoDartMessage\n  | SubmitVisitMessage",
        "  | UndoDartMessage\n  | CorrectDartMessage\n  | SubmitVisitMessage")

    match=root/'src/server/match.ts'
    replace(match,
        "/**\n * Find the next non-departed player's index in roster order, wrapping around.",
        """/**
 * Correct one dart in the current visit atomically. Re-run the mode's lock and
 * bust checks on the complete corrected visit. The expected id prevents a
 * delayed tap from replacing a newer camera-recognized dart at the same slot.
 */
export function correctDartInMatch(
  match: MatchState, index: number, expectedDartId: string, dart: DartThrow,
): { success: true; match: MatchState } | Failure {
  const mode = activeMode(match);
  if (isFailure(mode)) return mode;
  const cv = match.currentVisit;
  if (!cv || !Number.isInteger(index) || index < 0 || index >= cv.darts.length)
    return { success: false, error: 'Dart is no longer available to correct' };
  if (cv.darts[index].id !== expectedDartId)
    return { success: false, error: 'Dart changed while you were editing; reopen correction' };
  const darts = cv.darts.map((previous, i) =>
    i === index ? { ...dart, id: previous.id } : previous);
  const next: MatchState = { ...match, currentVisit: { ...cv, darts, locked: false } };
  next.currentVisit = { ...next.currentVisit!, locked: lockedNow(mode, next) };
  return { success: true, match: next };
}

/**
 * Find the next non-departed player's index in roster order, wrapping around.""")

    handler=root/'src/server/wsHandler.ts'
    replace(handler,
        "import { addDartToMatch, undoDartFromMatch, submitVisitToMatch, nextActiveIndex } from './match';",
        "import { addDartToMatch, undoDartFromMatch, correctDartInMatch, submitVisitToMatch, nextActiveIndex } from './match';")
    replace(handler,
        """    case 'undo_dart':
      handleUndoDart(ws);
      break;""",
        """    case 'undo_dart':
      handleUndoDart(ws);
      break;
    case 'correct_dart':
      handleCorrectDart(ws, msg);
      break;""")
    replace(handler,
        "  'add_dart', 'undo_dart', 'submit_visit', 'rematch_vote',",
        "  'add_dart', 'undo_dart', 'correct_dart', 'submit_visit', 'rematch_vote',")
    replace(handler,
        "function handleSubmitVisit(ws: WebSocket): void {",
        """function handleCorrectDart(ws: WebSocket, msg: {index: unknown; expectedDartId: unknown; dart: unknown}): void {
  const req = requireMatch(ws);
  if (!req) return;
  const {client,match} = req;
  const cv = match.currentVisit;
  if (!cv || !holdsPlayer(client, cv.playerId)) {
    send(ws, {type:'error',message:'Only the throwing player can correct their darts'});
    return;
  }
  const dart = validateDartThrow(msg.dart);
  if (!dart || !Number.isInteger(msg.index) || typeof msg.expectedDartId !== 'string') {
    send(ws, {type:'error',message:'Invalid dart correction'});
    return;
  }
  const result = correctDartInMatch(match, msg.index as number, msg.expectedDartId, dart);
  if (!result.success) {send(ws, {type:'error',message:result.error}); return;}
  commitScoredMatch(result.match);
}

function handleSubmitVisit(ws: WebSocket): void {""")

    use_match=root/'src/client/hooks/useMatch.ts'
    replace(use_match,
        """  const undoDart = useCallback(() => {
    send({ type: 'undo_dart' });
  }, [send]);""",
        """  const undoDart = useCallback(() => {
    send({ type: 'undo_dart' });
  }, [send]);

  const correctDart = useCallback((index: number, expectedDartId: string, dart: DartThrow) => {
    send({ type: 'correct_dart', index, expectedDartId, dart });
  }, [send]);""")
    # DartThrow already exists in the hook imports? ensure explicitly typed.
    source=use_match.read_text(encoding='utf-8')
    if not "import type { DartThrow } from '../" in source and "DartThrow" not in source.split('\n',10)[0:10]:
        replace(use_match,
            "import { useCallback",
            "import type { DartThrow } from '../../shared/types';\nimport { useCallback")
    replace(use_match,
        "    undoDart,\n    submitVisit,",
        "    undoDart,\n    correctDart,\n    submitVisit,")

    app=root/'src/client/App.tsx'
    replace(app,"    addDart,\n    undoDart,\n  } = useMatch",
        "    addDart,\n    undoDart,\n    correctDart,\n  } = useMatch")
    replace(app,
        "            addDart={addDart}\n            undoDart={undoDart}",
        "            addDart={addDart}\n            undoDart={undoDart}\n            correctDart={correctDart}")
    replace(app,
        "  undoDart: () => void;\n  submitVisit: () => void;",
        "  undoDart: () => void;\n  correctDart: (index: number, expectedDartId: string, dart: DartThrow) => void;\n  submitVisit: () => void;")
    # Type declaration imports DartThrow via shared types.
    replace(app,
        "import type { Lobby, MatchState, ModePanel, ModeView, RematchAnswer } from '../shared/types';",
        "import type { Lobby, MatchState, ModePanel, ModeView, RematchAnswer, DartThrow } from '../shared/types';")
    replace(app,
        "leaveMatch, addDart, undoDart, submitVisit, onVoteRematch",
        "leaveMatch, addDart, undoDart, correctDart, submitVisit, onVoteRematch")
    replace(app,
        "      onAddDart={addDart}\n      onUndoDart={undoDart}",
        "      onAddDart={addDart}\n      onUndoDart={undoDart}\n      onCorrectDart={correctDart}")
    replace(app,
        "        onAddDart={() => {}}\n        onUndoDart={() => {}}",
        "        onAddDart={() => {}}\n        onUndoDart={() => {}}\n        onCorrectDart={() => {}}")

    screen=root/'src/client/pages/MatchScreen.tsx'
    replace(screen,
        "  onUndoDart: () => void;\n  onSubmitVisit: () => void;",
        "  onUndoDart: () => void;\n  onCorrectDart: (index: number, expectedDartId: string, dart: DartThrow) => void;\n  onSubmitVisit: () => void;")
    replace(screen,
        "  onUndoDart,\n  onSubmitVisit,",
        "  onUndoDart,\n  onCorrectDart,\n  onSubmitVisit,")
    replace(screen,
        "          onUndoDart={onUndoDart}\n          onSubmitVisit={onSubmitVisit}",
        "          onUndoDart={onUndoDart}\n          onCorrectDart={onCorrectDart}\n          onSubmitVisit={onSubmitVisit}")

    marker=root/'src/client/public/dartline-build.txt'
    marker.write_text('dartline-specific-correction-board-camera-v2.4-2026-11-22\n',encoding='utf-8')
    print('DartLine precise corrections, board geometry and camera underlay installed')
if __name__=='__main__':
    try: patch(Path(sys.argv[1]).resolve())
    except Exception as e:
        print('DartLine v2.4 integration failed:',e,file=sys.stderr)
        sys.exit(1)
