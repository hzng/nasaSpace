// View presets use measured catalog positions; a scope is not a complete census.
export function installContextScopes({getScene,contextView,showSolar,syncSceneControls,toast}){
 const panel=document.getElementById('context-scopes');
 const buttons=[...panel.querySelectorAll('[data-scope]')];
 const note=document.getElementById('context-scope-note');
 // Let controls flow together at every viewport width, including when the
 // optional scale menu expands, instead of overlapping absolute-position rows.
 panel.parentElement?.append(document.getElementById('star-filters'));
 let busy=false;
 async function change(scope){
  if(busy||getScene()?.journey)return;
  busy=true;buttons.forEach(button=>button.disabled=true);
  note.textContent='Preparing view…';
  try{
   await contextView();
   const scene=getScene();if(!scene)throw Error('3D view is unavailable.');
   scene.leaveSunSky();scene.stopFlight();scene.zoomImpulse=0;scene.navKeys?.clear();
   if(scope==='solar'){
    if(scene.mode!=='solar')await showSolar();
    if(scene.mode!=='solar'||!scene.items.some(item=>item.data.id==='sun'))throw Error('Solar System could not be loaded.');
    scene.selected='sun';syncSceneControls();
    await scene.overview();
    note.textContent='Sun-centered · planets out to Neptune';
   }else{
    const radius=scope==='nearby'?10:100;
    const catalog=await scene.loadContextSky();
    const objects=(catalog?.objects||[]).filter(star=>Number.isFinite(star.distance_pc)&&star.distance_pc>0&&star.distance_pc<=radius&&star.xyz_pc?.length===3&&star.xyz_pc.every(Number.isFinite));
    if(!objects.length)throw Error('No catalog distances are available for this scope.');
    // Preserve orientation when changing parsec scopes; start an AU-to-pc
    // transition at a safe near-Sun point instead of reinterpreting AU as pc.
    scene.exitLocal();
    const previous=scene.mode==='stars'?scene.camera.position.clone():scene.vector([0,-.03,.02]);
    scene.stars({scope:'nearby',radius_pc:radius,objects,unknown:[],notes:[catalog.note||'Incomplete catalog sample.']},false);
    scene.camera.position.copy(previous);scene.controls.target.set(0,0,0);
    scene.selected='origin';scene.filterRadius=radius;scene.filterMagnitude=99;scene.applyFilter();
    const radiusControl=document.getElementById('visible-radius');
    if(![...radiusControl.options].some(option=>Number(option.value)===radius))radiusControl.add(new Option(radius+' pc',String(radius)));
    radiusControl.value=String(radius);
    const magnitudeControl=document.getElementById('visible-magnitude');
    if(![...magnitudeControl.options].some(option=>option.value==='99'))magnitudeControl.add(new Option('All loaded','99'));
    magnitudeControl.value='99';
    document.getElementById('visible-count').textContent=objects.length+' catalog stars · incomplete sample';
    syncSceneControls();
    document.getElementById('scene-title').textContent=scope==='nearby'?'Nearby stars.':'Our stellar neighborhood.';
    document.getElementById('scene-subtitle').textContent='Within '+radius+' pc of the Sun · catalog positions and distances';
    const extent=radius;
    await scene.fly(scene.vector([0,0,0]),scene.vector([extent*.65,-extent*1.35,extent*.8]),2200);
    note.textContent=radius+' pc radius · '+objects.length+' catalog stars · incomplete sample';
   }
   buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scope===scope)));
  }catch(error){note.textContent=error.message;toast(error.message);}
  finally{busy=false;buttons.forEach(button=>button.disabled=false);}
 }
 buttons.forEach(button=>button.addEventListener('click',()=>change(button.dataset.scope)));
 return change;
}
