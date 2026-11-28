// Release regression: real upstream board photographs through the real model,
// video decoding, mobile camera iframe, WebSocket scoring and turn submission.
// Only getUserMedia is substituted by the upstream test-camera MediaStream.
import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {installFakeCamera} from './fakeCamera';
import {skipOnboarding} from './appHelpers';

const scenes={
  empty:fileURLToPath(new URL('../media/board-empty.jpg',import.meta.url)),
  darts:fileURLToPath(new URL('../media/board-three-darts.jpg',import.meta.url)),
};
test.setTimeout(180_000);
test('same phone: real model, three consecutive three-dart visits, no duplicates, automatic removal',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera']});
 const page=await context.newPage();
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await skipOnboarding(context);
 await installFakeCamera(page,scenes,{maxWidth:1280,maxHeight:720});
 // Test seam only; the camera frames, classifier, scoring and submission are real.
 await context.addInitScript(()=>{
   try{sessionStorage.setItem('instadarts_e2e','1');}catch{}
 });
 try{
   await page.goto('/?e2e=1');
   await page.getByRole('button',{name:'Use this phone as the dartboard camera'}).click();
   const iframe=page.locator('iframe[title="DartLine scoring camera"]');
   await expect(iframe).toBeVisible({timeout:30000});
   const phone=page.frameLocator('iframe[title="DartLine scoring camera"]');
   const toggle=phone.getByRole('switch',{name:/^(?:Start camera|Resume camera|Turn camera off)$/});
   await expect(toggle).toBeEnabled({timeout:90000});
   if(!await toggle.isChecked())await toggle.evaluate((el:HTMLInputElement)=>el.click());
   await expect(toggle).toBeChecked({timeout:90000});
   await page.getByRole('button',{name:'Show game · Hide camera'}).click();
   await page.getByText('Local Match',{exact:true}).click();
   await page.getByRole('textbox',{name:'New player',exact:true}).fill('Replay');
   await page.getByRole('button',{name:'Add',exact:true}).click();
   await page.getByLabel('Starting Score').selectOption('701');
   await page.getByText('Start Match',{exact:true}).click();
   const hud=page.getByRole('region',{name:'DartLine mobile scoreboard'});
   await expect(hud).toBeVisible({timeout:30000});
   const auto=hud.getByRole('button',{name:/Auto-submit on board clear/});
   if(await auto.getAttribute('aria-pressed')!=='true')await auto.click();
   await expect(auto).toHaveAttribute('aria-pressed','true');
   const diagnostics=hud.locator('details').filter({hasText:'Camera Diagnostics'});
   await diagnostics.locator('summary').click();
   await expect(diagnostics).toContainText('scoring true',{timeout:30000});
   await expect(diagnostics).toContainText('empty reference true',{timeout:30000});
   const frame=page.frames().find(f=>f.url().includes('/scorer'));
   if(!frame)throw new Error('same-phone scorer iframe missing');
   const scene=async(name:string)=>frame.evaluate(async name=>{
     await (window as any).__scene(name);
   },name);
   const slots=hud.locator('.dartline-hud-dart strong');
   const score=hud.locator('.dartline-hud-primary strong');
   for(let round=0;round<3;round++){
     await expect(slots).toHaveText(['—','—','—']);
     await scene('darts');
     await expect(hud.locator('.dartline-hud-round-label strong')).toHaveText('Visit: 140',{timeout:20000});
     // A stationary occupied camera must not submit or change the three scores.
     const recorded=await slots.allTextContents();
     expect(recorded.every(x=>x!=='—')).toBe(true);
     await page.waitForTimeout(1800);
     await expect(slots).toHaveText(recorded);
     await scene('empty');
     await expect(slots).toHaveText(['—','—','—'],{timeout:12000});
     await expect(score).toHaveText(String(701-140*(round+1)));
     await expect(diagnostics).toContainText('empty reference true');
     console.log('REAL_MODEL_MOBILE_VISIT_PASSED',round+1,recorded.join(','));
   }
   expect(errors).toEqual([]);
 }catch(e){
   console.log('REAL_MODEL_MOBILE_ERROR',String(e));
   console.log('MOBILE_BODY',await page.locator('body').innerText().catch(()=>'<unavailable>'));
   const scorer=page.frames().find(f=>f.url().includes('/scorer'));
   if(scorer)console.log('SCORER_BODY',await scorer.locator('body').innerText().catch(()=>'<unavailable>'));
   throw e;
 }finally{await context.close();}
});
