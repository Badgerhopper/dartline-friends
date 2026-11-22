import { boardRadii, BOARD_CENTER, BOARD_MAX, SECTOR_ORDER } from '../../shared/boardGeometry';
import { scoreFromBoardCoords } from '../../shared/scoring';
import type { DartThrow } from '../../shared/types';

/** Convert a player's explicit correction into the normal scored-board input. */
export type ManualRing = 'single' | 'double' | 'triple';
export function correctedDart(sector: string, ring: ManualRing): DartThrow {
  const radii = boardRadii(BOARD_MAX);
  let x = BOARD_CENTER, y = BOARD_CENTER;
  if (sector === 'BULL') {
    if (ring === 'triple') throw new Error('There is no triple bull');
    // Inner bull is a point at centre; single bull is an annulus around it.
    y += ring === 'single' ? Math.round((radii.innerBull + radii.outerBull) / 2) : 0;
  } else {
    const number = Number(sector);
    if (!Number.isInteger(number) || number < 1 || number > 20) throw new Error('Invalid segment');
    const index = SECTOR_ORDER.indexOf(number);
    const angle = (index * Math.PI) / 10;
    const radius = ring === 'double'
      ? (radii.doubleInner + radii.doubleOuter) / 2
      : ring === 'triple'
        ? (radii.tripleInner + radii.tripleOuter) / 2
        : (radii.tripleOuter + radii.doubleInner) / 2;
    x += Math.round(Math.sin(angle) * radius);
    y += Math.round(Math.cos(angle) * radius);
  }
  return { x, y, score: scoreFromBoardCoords(x, y) };
}
