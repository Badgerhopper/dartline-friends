/** X01 checkout suggestions calculated against the exact game-mode rules.
 * Every proposed last dart is a double in Double Out, including the bullseye.
 * No three-dart "bogey" suggestions, no impossible finishes. */
export interface CheckoutShot {
  label: string;
  points: number;
  number: number;
  ring: 'S' | 'D' | 'T' | 'B';
}
export interface CheckoutRoute { darts: string[]; total: number }
export interface CheckoutOptions { remaining: number; dartsAvailable: number; doubleOut: boolean }

export const CHECKOUT_SHOTS: readonly CheckoutShot[] = [
  ...Array.from({length: 20}, (_, i) => ({label: `S${i + 1}`, points: i + 1, number: i + 1, ring: 'S' as const})),
  ...Array.from({length: 20}, (_, i) => ({label: `D${i + 1}`, points: (i + 1) * 2, number: i + 1, ring: 'D' as const})),
  ...Array.from({length: 20}, (_, i) => ({label: `T${i + 1}`, points: (i + 1) * 3, number: i + 1, ring: 'T' as const})),
  {label:'SB',points:25,number:25,ring:'B'},
  {label:'DB',points:50,number:50,ring:'D'},
];

const IDEAL_DOUBLES = [20,16,18,12,10,8,4,14,6,5,2,1,9,7,3,11,13,15,17,19];
function lastScore(shot: CheckoutShot): number {
  if (shot.label === 'DB') return 8;
  if (shot.ring === 'D') return Math.max(0, 45 - IDEAL_DOUBLES.indexOf(shot.number) * 2);
  return shot.label === 'T20' ? 30 : shot.ring === 'T' ? 15 + shot.number / 10 : 0;
}
function quality(path: readonly CheckoutShot[], remaining: number): number {
  const last=path[path.length-1];
  let points=lastScore(last);
  for (let i=0;i<path.length-1;i++) {
    const shot=path[i];
    // Favor high treble scoring on larger finishes, safe singles to set up
    // an easy double on lower finishes, and avoid wasting doubles as setup.
    points += remaining > 100
      ? shot.ring === 'T' ? shot.points * .45 : shot.ring === 'S' ? shot.points * .06 : -4
      : shot.ring === 'S' ? 10 + shot.points * .15 : shot.ring === 'T' ? 6 + shot.points * .1 : -5;
    if (shot.label === 'T20') points += remaining > 90 ? 8 + (path.length - i) * .4 : -1;
  }
  return points;
}
export function checkoutSuggestions({
  remaining, dartsAvailable, doubleOut,
}: CheckoutOptions): CheckoutRoute[] {
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 170
    || !Number.isInteger(dartsAvailable) || dartsAvailable < 1) return [];

  const allowed=CHECKOUT_SHOTS.filter(s=>s.points<=remaining);
  const possible: {path:CheckoutShot[]; rating:number}[]=[];
  const maxDarts=Math.min(3,dartsAvailable);

  function search(left:number, path:CheckoutShot[], depth:number):void {
    if (left===0) {
      const last=path[path.length-1];
      if (!last || (doubleOut && last.ring !== 'D')) return;
      possible.push({path:[...path],rating:quality(path,remaining)});
      return;
    }
    if (depth>=maxDarts || left<0 || (doubleOut && left===1)) return;
    for(const shot of allowed) {
      if (shot.points > left) continue;
      if (shot.points===left && doubleOut && shot.ring!=='D') continue;
      // No point in aiming at an interim dart that leaves an impossible 1 in double-out.
      if (doubleOut && left-shot.points===1) continue;
      search(left-shot.points,[...path,shot],depth+1);
    }
  }
  search(remaining,[],0);

  possible.sort((a,b)=>{
    const len=a.path.length-b.path.length;
    return len || b.rating-a.rating || a.path.map(s=>s.label).join().localeCompare(b.path.map(s=>s.label).join());
  });
  // Three genuinely different options are more useful than twenty permutations
  // of the same checkout. Choose by first target, avoiding duplicate paths.
  const seen=new Set<string>();
  const selected:CheckoutRoute[]=[];
  for(const {path} of possible) {
    const label=path.map(x=>x.label).join(' · ');
    if(seen.has(label)) continue;
    if(selected.length>0 && selected.some(s=>s.darts[0]===path[0].label && s.darts.length===path.length)) continue;
    selected.push({darts:path.map(x=>x.label),total:path.reduce((sum,x)=>sum+x.points,0)});
    seen.add(label);
    if(selected.length===3) break;
  }
  return selected;
}
