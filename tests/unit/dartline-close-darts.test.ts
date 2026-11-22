import { describe, expect, it } from 'vitest';
import { clusterNewTips } from '../../src/server/scoring/cluster';
import { DartTracker } from '../../src/server/scoring/tracker';
import type { DartPoint } from '../../src/shared/vision/types';

const tip=(x:number,deviceId:string):DartPoint => ({x,y:720000,confidence:.94,deviceId});

describe('DartLine nearby-dart preservation',()=>{
 it('keeps two tips within the cross-camera merge radius distinct for the same iPhone',()=>{
   const cluster=clusterNewTips([tip(500000,'iphone'),tip(507000,'iphone')]);
   expect(cluster).toHaveLength(2);
   expect(cluster.every(x=>x.cameraCount===1)).toBe(true);
 });
 it('keeps all three clustered treble-bed tips when the model sees them',()=>{
   const got=new DartTracker().ingest([{deviceId:'iphone',tips:[
     {x:480000,y:720000,confidence:.95},
     {x:486500,y:720000,confidence:.88},
     {x:494000,y:720000,confidence:.91},
   ]}]);
   expect(got).toHaveLength(3);
 });
 it('continues to fuse different phones observing the same physical dart',()=>{
   const result=clusterNewTips([tip(500000,'phone-a'),tip(507000,'phone-b')]);
   expect(result).toHaveLength(1);
   expect(result[0].cameraCount).toBe(2);
 });
});
