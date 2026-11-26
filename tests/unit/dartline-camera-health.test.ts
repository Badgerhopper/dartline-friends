import {describe,expect,it} from 'vitest';
import {cameraHealthLabel, CAMERA_STATUS_DELAY_MS, type CameraHealth} from '../../src/client/lib/cameraHealth';
const health=(overrides:Partial<CameraHealth>={}):CameraHealth=>({
  cameraActive:true,scoring:true,scanning:true,motionFps:8.0,
  lastHealthAt:1000,armedSince:0,error:null,...overrides,
});
describe('DartLine phone camera status cannot interrupt inference',()=>{
 it('reports a watching camera even when no dart was scored for a minute',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:59500}),60000)).toBe('Watching for dart');
 });
 it('describes old heartbeats as a delayed update, not a dead camera',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:1000}),1000+CAMERA_STATUS_DELAY_MS+1))
    .toBe('Camera update delayed');
  expect(cameraHealthLabel(health({lastHealthAt:1000}),1000+CAMERA_STATUS_DELAY_MS))
    .toBe('Watching for dart');
 });
 it('describes the delayed-motion-analyzer case without declaring a failed link',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:20000,motionFps:0}),20100)).toBe('Camera feed waiting');
 });
 it('allows model and video startup without immediately declaring a stall',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:500,motionFps:0,armedSince:0}),750)).toBe('Starting camera scan');
 });
 it('differentiates inactive and unassigned cameras from AI errors',()=>{
  expect(cameraHealthLabel(null,0)).toBe('Connecting camera');
  expect(cameraHealthLabel(health({cameraActive:false}),2000)).toBe('Camera off');
  expect(cameraHealthLabel(health({scoring:false}),2000)).toBe('Camera not assigned');
  expect(cameraHealthLabel(health({error:'processor crashed'}),2000)).toBe('AI error · open camera');
  expect(cameraHealthLabel(health({scanning:false}),2000)).toBe('Auto scan off');
 });
});
