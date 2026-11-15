import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('@playwright/test'));}
catch{({chromium}=require('../runtime/browser-qa/node_modules/playwright'));}
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://127.0.0.1:8000/');
 await page.locator('#universe-home').click();
 await page.waitForFunction(()=>window.parallax?.state.solarLoaded,null,{timeout:60000});
 await page.evaluate(async()=>{
  const catalog=await parallax.scene.loadContextSky();
  const star=catalog.objects.find(item=>item.name.toLowerCase().includes('barnard'));
  window.dispatchEvent(new CustomEvent('catalog-context-select',{detail:star}));
 });
 await page.waitForFunction(()=>parallax.scene.mode==='stars'&&!document.getElementById('trace-earth').disabled,null,{timeout:30000});
 await page.locator('#trace-earth').click();
 await page.waitForFunction(()=>parallax.scene.flight?.continuousEarth);
 const first=await page.evaluate(()=>parallax.scene.camera.position.toArray());
 await page.waitForTimeout(1200);
 const second=await page.evaluate(()=>parallax.scene.camera.position.toArray());
 assert.notDeepEqual(first,second,'Earth flight moves the camera');
 await page.waitForFunction(()=>parallax.scene.selected==='earth'&&!document.getElementById('journey-stay').hidden,null,{timeout:90000});
 console.log('Earth flight completed');
 await page.locator('#journey-stay').click();
 for(const scope of ['solar','nearby','wide']){
  await page.locator(`[data-scope="${scope}"]`).click();
  await page.waitForFunction(scope=>document.querySelector(`[data-scope="${scope}"]`).getAttribute('aria-pressed')==='true'&&!document.querySelector(`[data-scope="${scope}"]`).disabled,scope,{timeout:60000});
  const state=await page.evaluate(()=>({mode:parallax.scene.mode,distance:parallax.scene.camera.position.length(),radius:parallax.scene.filterRadius,count:parallax.scene.items.filter(item=>item.mesh.visible).length,note:document.getElementById('context-scope-note').textContent}));
  console.log(scope,state);
  assert.equal(state.mode,scope==='solar'?'solar':'stars');
  if(scope!=='solar')assert.equal(state.radius,scope==='nearby'?10:100);
 }
 await page.screenshot({path:'runtime/context-scopes-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No mobile page overflow');
 const box=await page.locator('#context-scopes').boundingBox();
 assert.ok(box&&box.x>=0&&box.x+box.width<=391,'Scope controls fit on mobile');
 const filters=await page.locator('#star-filters').boundingBox();
 assert.ok(filters.y>=box.y+box.height,'Catalog filters do not cover scope buttons');
 await page.screenshot({path:'runtime/context-scopes-mobile.png'});
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
