import type { MatchState, Player } from '../../shared/types';

/** Return the remote thrower only when another board owns the active turn.
 * A local match (one device owning several players, or one shared board) must
 * keep the standard scoring UI throughout. */
export function remoteTurnOpponent(
  match: Pick<MatchState, 'players' | 'currentPlayerIndex' | 'status'>,
  ownPlayerIds: readonly string[],
  isSpectator: boolean,
): Player | null {
  if (match.status !== 'in_progress' || isSpectator || ownPlayerIds.length === 0) return null;
  const thrower = match.players[match.currentPlayerIndex];
  if (!thrower) return null;
  const mine = new Set(ownPlayerIds);
  if (mine.has(thrower.id)) return null;

  // Public match players have a boardId for all local player slots at one board.
  // The server-side sessionId fallback keeps the function valid for unit tests.
  const boardOf = (p: Player) => p.boardId ?? p.sessionId ?? p.id;
  const ownedBoards = new Set(match.players.filter(p => mine.has(p.id)).map(boardOf));
  if (ownedBoards.size === 0 || ownedBoards.has(boardOf(thrower))) return null;
  return thrower;
}
