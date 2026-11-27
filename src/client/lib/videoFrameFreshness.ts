/** On iOS, repeated drawImage calls are NOT evidence of new video frames.
 * Video may be paused/suspended while readyState remains HAVE_CURRENT_DATA.
 * requestVideoFrameCallback is the browser's proof that a new decoded frame
 * was presented. Do not use timers or video.currentTime as replacements.
 *
 * If the native callback isn't supported, return null and let the existing
 * AI-based verifier handle takeout instead. This is intentional fail-closed
 * behavior, not a camera error. No images are stored or transmitted.
 */
export const FRESH_VIDEO_MAX_AGE_MS=750;

type PresentableVideo = Pick<HTMLVideoElement,
  'srcObject' | 'readyState' |
  'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>;

export class VideoFrameFreshness {
  private video:PresentableVideo|null=null;
  private source:MediaProvider|null=null;
  private pending:number|null=null;
  private seq=0;
  private lastFrameAt=0;
  private alive=false;

  private schedule():void{
    const video=this.video;
    if(!this.alive || !video ||
      typeof video.requestVideoFrameCallback!=='function')return;
    this.pending=video.requestVideoFrameCallback((_time,metadata)=>{
      if(!this.alive||this.video!==video||video.srcObject!==this.source)
        return;
      this.pending=null;
      this.seq=Math.max(this.seq+1,
        Number.isSafeInteger(metadata.presentedFrames)
        ? metadata.presentedFrames:0);
      this.lastFrameAt=Date.now();
      this.schedule();
    });
  }

  sample(video:PresentableVideo|null,now:number):number|null{
    if(!video || video.readyState<2 || !video.srcObject ||
       !Number.isFinite(now) || now<=0){
      this.stop();return null;
    }
    if(video!==this.video || video.srcObject!==this.source){
      this.stop();
      this.video=video;
      this.source=video.srcObject;
      this.alive=true;
      this.schedule();
    }
    if(!this.seq || !this.lastFrameAt ||
       now<this.lastFrameAt ||
       now-this.lastFrameAt>FRESH_VIDEO_MAX_AGE_MS)return null;
    return this.seq;
  }

  stop():void{
    this.alive=false;
    if(this.video && this.pending!==null &&
       typeof this.video.cancelVideoFrameCallback==='function'){
      try{this.video.cancelVideoFrameCallback(this.pending);}catch{}
    }
    this.video=null;this.source=null;this.pending=null;
    this.seq=0;this.lastFrameAt=0;
  }
}
