/**
 * Separate, tiny pixel-motion witness for retrieving darts.
 * The model can mistake a dart-filled board for empty. Never submit merely
 * because it returned [] several times; require an actual visual change in
 * the live camera followed by stable frames.
 *
 * Frames are 48x48 grayscale and stay ON DEVICE. No images are uploaded.
 * Prewarm the reference from the second dart onward so a quick hand reaching
 * in immediately after the third score cannot outrun the first baseline.
 * A global exposure change is subtracted before the pixel comparison.
 */
export const TAKEOUT_SAMPLE_PIXELS = 48;
export const TAKEOUT_CHANGE_RATIO = 0.08;
export const TAKEOUT_QUIET_RATIO = 0.035;
const CHANGE_LUMA = 24;
const QUIET_LUMA = 18;

function difference(a: Uint8Array, b: Uint8Array, threshold: number): number {
  if (!a.length || a.length !== b.length) return 1;
  let sumA=0, sumB=0;
  for (let i=0;i<a.length;i++) {
    sumA+=a[i];
    sumB+=b[i];
  }
  const offset=(sumB-sumA)/a.length;
  let changed=0;
  for(let i=0;i<a.length;i++) {
    if (Math.abs(b[i]-a[i]-offset)>threshold) changed++;
  }
  return changed/a.length;
}

export class TakeoutSceneWitness {
  private first: Uint8Array | null = null;
  private previous: Uint8Array | null = null;
  private baselineAt=0;
  private moved=false;
  private stableFrames=0;
  private fired=false;

  reset():void {
    this.first=null;
    this.previous=null;
    this.baselineAt=0;
    this.moved=false;
    this.stableFrames=0;
    this.fired=false;
  }

  observe(frame:Uint8Array, now:number, allowCompletion=true):boolean {
    if (this.fired && allowCompletion) return false;
    if (!Number.isFinite(now) || now<=0 ||
        frame.length !== TAKEOUT_SAMPLE_PIXELS*TAKEOUT_SAMPLE_PIXELS) return false;
    if (!this.first || !this.previous) {
      this.first=frame.slice();
      this.previous=frame.slice();
      this.baselineAt=now;
      return false;
    }
    // Do not treat a single camera exposure adjustment as hand movement.
    const changed=difference(this.first,frame,CHANGE_LUMA);
    const quiet=difference(this.previous,frame,QUIET_LUMA);
    if (allowCompletion && changed>=TAKEOUT_CHANGE_RATIO && now-this.baselineAt >= 200) {
      this.moved=true;
    }
    // Do not accept a stationary hand covering the board as retrieval.
    // It must LEAVE the image and the board must settle near the prior
    // view (thin removed shafts can legitimately change a few pixels).
    const handHasExited=changed < TAKEOUT_CHANGE_RATIO*0.75;
    if(!allowCompletion) {this.moved=false;this.stableFrames=0;}
    this.stableFrames=this.moved && allowCompletion && handHasExited && quiet <= TAKEOUT_QUIET_RATIO
      ? this.stableFrames+1 : 0;
    this.previous=frame.slice();
    if(allowCompletion && this.stableFrames >= 2) {
      this.fired=true;
      return true;
    }
    return false;
  }
}

/** Read the video without interrupting LiteRT. Returns null on absent/invalid video. */
export function readTakeoutScene(
  video:HTMLVideoElement | null,
  canvas:HTMLCanvasElement
):Uint8Array|null {
  if(!video || video.readyState<2 || !video.videoWidth || !video.videoHeight) return null;
  const size=TAKEOUT_SAMPLE_PIXELS;
  if(canvas.width!==size)canvas.width=size;
  if(canvas.height!==size)canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return null;
  try {
    const side=Math.min(video.videoWidth,video.videoHeight);
    ctx.drawImage(video,(video.videoWidth-side)/2,
      (video.videoHeight-side)/2,side,side,0,0,size,size);
    const rgba=ctx.getImageData(0,0,size,size).data;
    const gray=new Uint8Array(size*size);
    for(let i=0;i<gray.length;i++){
      const k=i*4;
      gray[i]=Math.round(rgba[k]*0.299+rgba[k+1]*0.587+rgba[k+2]*0.114);
    }
    return gray;
  } catch {
    // iOS may briefly suspend camera decoding; absence of a frame is not
    // evidence of an empty board or a retrieval.
    return null;
  }
}
