import {describe,expect,it} from 'vitest';
import {cameraHealthLabel, shouldRecoverCameraLink, type CameraHealth} from '../../src/client/lib/cameraHealth';
const health=(overrides:Partial<CameraHealth>={}):CameraHealth=>({
  cameraActive:true,scoring:true,scanning:true,motionFps:8.0,
  lastHealthAt:1000,armedSince:0,error:null,...overrides,
});
describe('DartLine camera readiness vs genuine motion scanning failure',()=>{
 it('does NOT show stalled after 60 seconds with no scored or inferred darts',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:59500}),60000)).toBe('Watching for dart');
 });
 it('shows an actual lost iframe heartbeat',()=>{
  expect(cameraHealthLabel(health(),12000)).toBe('Camera link paused');
 });
 it('shows a motion-scanner pause when heartbeat lives but analyzed frames do not',()=>{
  expect(cameraHealthLabel(health({lastHealthAt:20000,motionFps:0}),20100)).toBe('Camera feed paused');
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

describe('scorer iframe watchdog',()=>{
 it('recovers one previously-active scoring iframe after 18 seconds without heartbeat',()=>{
  expect(shouldRecoverCameraLink(1000,19000,true,true,true,0)).toBe(true);
 });
 it('does not confuse slow model inference or a normal idle board with link failure',()=>{
  expect(shouldRecoverCameraLink(1000,18999,true,true,true,0)).toBe(false);
 });
 it('never retries indefinitely or reactivates an intentionally stopped camera',()=>{
  expect(shouldRecoverCameraLink(1000,30000,true,true,true,1)).toBe(false);
  expect(shouldRecoverCameraLink(1000,30000,true,true,false,0)).toBe(false);
  expect(shouldRecoverCameraLink(1000,30000,false,true,true,0)).toBe(false);
  expect(shouldRecoverCameraLink(1000,30000,true,false,true,0)).toBe(false);
  expect(shouldRecoverCameraLink(0,30000,true,true,true,0)).toBe(false);
 });
});
