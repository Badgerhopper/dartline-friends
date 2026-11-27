import {describe,expect,it,vi,afterEach} from 'vitest';
import {VideoFrameFreshness,FRESH_VIDEO_MAX_AGE_MS} from '../../src/client/lib/videoFrameFreshness';

type Callback=(t:number,m:{presentedFrames:number})=>void;
function camera(){
  let id=0,frames=0;
  const scheduled=new Map<number,Callback>();
  const media={};
  const v={
    srcObject:media,readyState:2,
    requestVideoFrameCallback(callback:Callback){
      scheduled.set(++id,callback);return id;
    },
    cancelVideoFrameCallback(key:number){scheduled.delete(key);},
  };
  return {
    video:v as unknown as HTMLVideoElement,
    fire(){
      const item=scheduled.entries().next().value as [number,Callback]|undefined;
      if(!item)throw Error('Not listening for decoded frames');
      scheduled.delete(item[0]);
      item[1](0,{presentedFrames:++frames});
    },
    changeSource(){v.srcObject={};},
    freeze(){v.readyState=2;},
    pause(){v.readyState=0;},
    active:()=>scheduled.size,
  };
}
afterEach(()=>vi.useRealTimers());
describe('iPhone camera freshness proof',()=>{
 it('does not believe a video element is live until a native decoded-frame callback',()=>{
   vi.useFakeTimers();vi.setSystemTime(1000);
   const x=camera(),proof=new VideoFrameFreshness();
   expect(proof.sample(x.video,1000)).toBeNull();
   expect(x.active()).toBe(1);
   x.fire();
   expect(proof.sample(x.video,1000)).toBe(1);
   expect(proof.sample(x.video,1000+FRESH_VIDEO_MAX_AGE_MS+1)).toBeNull();
   x.fire();vi.setSystemTime(2000);
   expect(proof.sample(x.video,2000)).toBe(2);
   proof.stop();expect(x.active()).toBe(0);
 });
 it('counts different decoded images, not repeated reads of the same image',()=>{
   vi.useFakeTimers();vi.setSystemTime(1000);
   const x=camera(),proof=new VideoFrameFreshness();
   proof.sample(x.video,1000);x.fire();
   for(const t of [1000,1240,1480]){
     expect(proof.sample(x.video,t)).toBe(1);
   }
   x.fire();
   expect(proof.sample(x.video,1500)).toBe(2);
 });
 it('invalidates stale evidence when the camera source changes mid-visit',()=>{
   vi.useFakeTimers();vi.setSystemTime(1000);
   const x=camera(),proof=new VideoFrameFreshness();
   proof.sample(x.video,1000);x.fire();
   expect(proof.sample(x.video,1010)).toBe(1);
   x.changeSource();
   expect(proof.sample(x.video,1100)).toBeNull();
   x.fire();vi.setSystemTime(1200);
   expect(proof.sample(x.video,1200)).toBe(1);
 });
 it('fails closed on stopped camera, hidden video or missing native API',()=>{
   vi.useFakeTimers();vi.setSystemTime(1000);
   const x=camera(),proof=new VideoFrameFreshness();
   proof.sample(x.video,1000);x.fire();
   x.pause();
   expect(proof.sample(x.video,1200)).toBeNull();
   x.video.readyState=2;
   (x.video as unknown as {requestVideoFrameCallback?:Callback}).requestVideoFrameCallback=undefined;
   expect(proof.sample(x.video,1300)).toBeNull();
 });
});
