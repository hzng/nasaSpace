import {installContextScopes} from './context-scopes.js';
import {installSatelliteView} from './satellite-view.js?v=space-loader';
const $=id=>document.getElementById(id);
const icons={search:'<circle cx="7.5" cy="7.5" r="5"/><path d="m11.5 11.5 4 4"/>',close:'<path d="m4 4 10 10M14 4 4 14"/>',theme:'<circle cx="9" cy="9" r="5.5"/><path d="M9 3.5v11a5.5 5.5 0 0 0 0-11"/>',info:'<circle cx="9" cy="9" r="7"/><path d="M9 8v5M9 5v.2"/>',expand:'<path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4"/>',target:'<circle cx="9" cy="9" r="5"/><path d="M9 1v4M9 13v4M1 9h4M13 9h4"/>',arrow:'<path d="M3 9h12M10 4l5 5-5 5"/>',link:'<path d="m7 11 4-4M6 13l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0M12 5l1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>',play:'<path d="m5 3 9 6-9 6Z"/>',pause:'<path d="M6 3v12M12 3v12"/>',prev:'<path d="M4 4v10M14 4l-8 5 8 5Z"/>',next:'<path d="M14 4v10M4 4l8 5-8 5Z"/>',image:'<rect x="2" y="2" width="14" height="14" rx="2"/><circle cx="6" cy="6" r="1"/><path d="m2 13 5-5 4 4 2-2 3 3"/>'};
function icon(k){return '<svg viewBox="0 0 18 18" aria-hidden="true">'+(icons[k]||icons.info)+'</svg>';}document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
export function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
export async function api(url,options={}){let c=new AbortController(),timer=setTimeout(()=>c.abort(),100000);try{let r=await fetch(url,{...options,signal:c.signal});if(!r.ok){let t=await r.json().catch(()=>({detail:'Request failed ('+r.status+')'}));throw new Error(typeof t.detail==='string'?t.detail:JSON.stringify(t.detail));}return await r.json();}catch(e){if(e.name==='AbortError')throw new Error('The data service is taking too long. Please retry.');throw e;}finally{clearTimeout(timer);}}
const state={mode:'solar',solar:null,stars:null,selected:'earth',presets:[],scope:'nearby'};let scene=null;let cosmicBusy=false,cosmicReady=null;
function message(text){$('scene-message').textContent=text;$('scene-message').hidden=!text;}
function facts(rows){$('object-facts').replaceChildren();for(let [label,value] of rows){let dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('object-facts').append(dt,dd);}}
let selectionToken=0;
function selectedData(){return state.mode==='solar'?state.solar?.objects.find(x=>x.id===state.selected):state.stars?.objects.find(x=>x.id===state.selected);}
function contextParams(d){return new URLSearchParams({date:$('date').value,...(state.mode==='solar'||state.selected==='origin'?{body:state.selected==='origin'?'sun':state.selected}:{ra:d.ra,dec:d.dec,distance_pc:d.distance_pc})});}
function select(id,focus=false){let token=++selectionToken;state.selected=id;scene?.select(id,focus);let d=selectedData();if(id==='origin')d={id,name:'Sun',kind:'G-type star',description:'Our star is the origin of this catalog-distance view.',distance_pc:0,teff_gspphot:5772};if(!d)return;
 $('object-name').textContent=d.name;$('object-kind').textContent=state.mode==='solar'?d.kind.toUpperCase():'CATALOG / '+(d.catalog||'SUN').toUpperCase();$('object-description').textContent=d.description||'An individual catalog source. Its direction and distance are measured; its photosphere is unresolved.';
 if(state.mode==='solar'){facts([['From Sun',d.distance_sun_au.toFixed(3)+' AU'],['Mean radius',d.radius_km.toLocaleString('en-US')+' km'],[d.effective_temperature_k?'Effective temperature':'Orbital period',d.effective_temperature_k?d.effective_temperature_k.toLocaleString()+' K':(d.orbital_period_days||0).toLocaleString()+' days']]);$('object-source').textContent=d.asset_error||(d.id==='sun'?'Computed plasma / granulation illustration at 5,772 K. It is not a map of current sunspots.':d.texture_note);$('observe-selected').hidden=true;
 }else{facts([['From Sun',d.distance_pc.toFixed(3)+' pc / '+(d.distance_pc*3.26156).toFixed(2)+' ly'],['Distance interval',d.distance_lower_pc?d.distance_lower_pc.toFixed(3)+'–'+d.distance_upper_pc.toFixed(3)+' pc':'Reference origin'],['Temperature',d.teff_gspphot?Math.round(d.teff_gspphot).toLocaleString()+' K':'Not measured here'],['Magnitude',d.phot_g_mean_mag!=null?d.phot_g_mean_mag.toFixed(2)+' G':d.v_mag!=null?d.v_mag.toFixed(2)+' V':'Unavailable'],['Direction',d.ra!=null?d.ra.toFixed(3)+'°, '+d.dec.toFixed(3)+'°':'Solar origin']]);$('object-source').textContent=(d.catalog||'Solar reference')+' · '+(d.expanded_catalog?'HYG catalog distance; uncertainty unavailable. ':d.uncertain?'uncertain / model distance. ':'parallax distance. ')+(d.teff_gspphot?'Gaia GSP-Phot temperature is a model estimate. ':'')+'Approach opens a computed photosphere illustration. Individual spots, planets and terrain are unresolved; none are claimed as observations.';$('observe-selected').hidden=id==='origin';}
 $('trace-earth').hidden=id==='earth'||!!d.parent;$('trace-earth').disabled=true;if(scene)scene.readyJourneyContext=null;$('context-note').textContent='';
 if(state.mode==='stars'&&id!=='origin'&&!d.planets)api('/api/companions?'+new URLSearchParams({ra:d.ra,dec:d.dec,name:d.name})).then(r=>{d.planets=r.planets||[];}).catch(()=>{});
 if(id!=='earth')api('/api/journey?'+contextParams(d)).then(c=>{if(token!==selectionToken)return;scene.readyJourneyContext={selected:id,context:c};$('trace-earth').disabled=!(scene.mode==='solar'?scene.solarFlightReady:scene.cachedFlightSolar);$('context-note').textContent='Seen from Earth: '+c.constellation+'. Light travel time: '+(c.light_time_years<.01?(c.light_time_years*365.25*24*60).toFixed(1)+' minutes':c.light_time_years.toFixed(2)+' years')+'.';}).catch(error=>{if(token===selectionToken){$('context-note').textContent='Earth flight context: '+error.message;$('trace-earth').title='Reselect the object to retry.';}});
 $('object-strip').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===id));let b=[...$('object-strip').children].find(x=>x.dataset.id===id);b?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
function strip(items,solar){
 $('object-strip').replaceChildren();
 if(!solar){const home=document.createElement('button');home.className='solar-home';home.textContent='Solar System';home.onclick=()=>showSolar();const note=document.createElement('small');note.textContent='SUN · PLANETS · EARTH';home.append(note);$('object-strip').append(home);}
 const visible=solar?items:[{id:'origin',name:'Sun',distance_pc:0},...[...items].filter(i=>i.id!=='origin').sort((a,b)=>a.distance_pc-b.distance_pc)];
 for(const d of visible){const button=document.createElement('button');button.dataset.id=d.id;button.setAttribute('aria-pressed',d.id===state.selected);const span=document.createElement('span'),small=document.createElement('small');span.textContent=d.name.replace('Gaia DR3 ','');small.textContent=solar?(d.id==='sun'?'STAR':d.kind.includes('Terrestrial')?'ROCKY PLANET':d.kind.toUpperCase()):d.id==='origin'?'SOLAR SYSTEM':d.distance_pc.toFixed(2)+' pc';button.append(span,small);button.onclick=()=>d.id==='origin'?showSolar():select(d.id,true);$('object-strip').append(button);}
}
function filterStars(){if(!scene||state.mode!=='stars')return;scene.filterRadius=+$('visible-radius').value;scene.filterMagnitude=+$('visible-magnitude').value;let visible=scene.applyFilter();strip(visible,false);$('visible-count').textContent=visible.length+' visible · '+state.stars.objects.length+' loaded';}
let sceneLoadGeneration=0;
function solarControls(){
 $('star-filters').hidden=true;document.body.dataset.scene='solar';
 $('solar-tab').setAttribute('aria-pressed','true');$('stars-tab').setAttribute('aria-pressed','false');
 $('date').hidden=false;$('date-label').hidden=false;$('catalog-epoch').hidden=true;$('paths-toggle').hidden=false;
 $('size-note').textContent='Distances to scale · radii enlarged';$('scene-eyebrow').textContent='COMPUTED / EPHEMERIS';
 $('scene-title').textContent='Our place in space.';$('scene-subtitle').textContent='The Sun and eight planets, at their calculated positions.';
}
async function showSolar(date=$('date').value){
 const generation=++sceneLoadGeneration;state.mode='solar';solarControls();
 scene?.clear();if(scene){scene.loading=true;scene.controls.enabled=false;}
 $('scene-loading').hidden=false;$('inspector').hidden=true;$('object-strip').replaceChildren();message('');
 try{
  const data=await api('/api/solar?date='+date);if(generation!==sceneLoadGeneration)return;
  state.solar=data;await scene?.solar(data);if(generation!==sceneLoadGeneration)return;
  strip(data.objects,true);select(data.objects.some(x=>x.id===state.selected)?state.selected:'earth');
  // Put the camera in its initial view behind the loading cover, rather than
  // exposing a partially loaded world and then snapping into place.
  if(scene){const item=scene.items.find(i=>i.data.id===state.selected);scene.stopFlight();if(item){scene.controls.target.copy(item.pos);scene.camera.position.copy(item.pos).add(item.pos.clone().set(0,item.radius*1.8,item.radius*5));scene.controls.update();}}
  if(generation!==sceneLoadGeneration)return;
  state.solarLoaded=true;$('inspector').hidden=false;$('data-notes').textContent='Photos are flat; 3D depth comes from catalog distances. '+data.notes.join(' ');
 }catch(error){if(generation===sceneLoadGeneration){scene?.clear();message(error.message);}}
 finally{if(generation===sceneLoadGeneration){$('scene-loading').hidden=true;if(scene){scene.loading=false;scene.controls.enabled=true;}}}
}
async function showStars(scope='nearby'){sceneLoadGeneration++;$('scene-loading').hidden=true;if(scene){scene.loading=false;scene.controls.enabled=true;}state.mode='stars';$('star-filters').hidden=false;scene?.clear();$('inspector').hidden=true;$('object-strip').replaceChildren();document.body.dataset.scene='stars';state.scope=scope;$('solar-tab').setAttribute('aria-pressed','false');$('stars-tab').setAttribute('aria-pressed','true');$('date').hidden=true;$('date-label').hidden=true;$('catalog-epoch').hidden=false;$('paths-toggle').hidden=true;$('size-note').textContent='Catalog distances · unresolved starlight';$('scene-eyebrow').textContent='CATALOG / COMPUTED DEPTH';$('scene-title').textContent=scope==='nearby'?'Our stellar neighborhood.':'Your field, with distance.';$('scene-subtitle').textContent='Fetching measured catalog distances…';message('Querying Gaia DR3…');try{let d=await api('/api/space?'+new URLSearchParams({ra:$('ra').value,dec:$('dec').value,fov:$('fov').value,scope,radius_pc:$('radius').value,include_simbad:true}));if(state.mode!=='stars')return;state.stars=d;scene?.stars(d);$('inspector').hidden=false;$('visible-radius').value=scope==='field'?'1000':'5';filterStars();select(d.objects[0]?.id||'origin');$('scene-subtitle').textContent=d.objects.length+' catalog sources'+(scope==='nearby'?' within '+$('radius').value+' pc':' with usable distances')+' · '+d.unknown.length+' without depth'+(d.truncated?' · sample capped':'');$('data-notes').textContent='Photos are flat; 3D depth comes from catalog distances. '+d.notes.join(' ');message(d.objects.length?'':'No reliable catalog distances in this field. Try a larger field.');}catch(e){scene?.clear();$('inspector').hidden=true;$('object-strip').replaceChildren();$('scene-subtitle').textContent='No invented sources or distances are shown.';message(e.message);}}
$('solar-tab').onclick=async()=>{await contextView();await showSolar();};$('stars-tab').onclick=()=>showStars();$('date').value=new Date().toISOString().slice(0,10);$('date').onchange=()=>showSolar();$('focus').onclick=()=>scene?.focus();$('overview').onclick=()=>scene?.overview();$('labels-toggle').onclick=e=>{if(!scene)return;scene.showLabels=!scene.showLabels;e.currentTarget.textContent=scene.showLabels?'Selected label':'Labels off';e.currentTarget.setAttribute('aria-pressed',scene.showLabels);};$('paths-toggle').onclick=e=>{if(!scene)return;scene.showPaths=!scene.showPaths;scene.orbits.visible=scene.showPaths;e.currentTarget.textContent='Orbits '+(scene.showPaths?'on':'off');e.currentTarget.setAttribute('aria-pressed',scene.showPaths);};
function theme(light){document.documentElement.dataset.theme=light?'light':'dark';scene?.theme(light);$('theme').setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme');try{localStorage.setItem('parallax-theme',light?'light':'dark');}catch{};}
$('theme').onclick=()=>theme(document.documentElement.dataset.theme!=='light');try{theme(localStorage.getItem('parallax-theme')==='light');}catch{};
function searchPanel(open){if(document.body.classList.contains('observing')){$('search-panel').hidden=false;document.body.classList.remove('mobile-search');return;}$('search-panel').hidden=!open;document.body.classList.toggle('searching',open);$('search-toggle').setAttribute('aria-expanded',open);if(open)$('object-query').focus();} $('search-toggle').onclick=()=>searchPanel($('search-panel').hidden);$('search-close').onclick=()=>searchPanel(false);$('about-open').onclick=()=>$('about').showModal();$('about-close').onclick=()=>$('about').close();$('about').addEventListener('click',e=>{if(e.target===$('about'))$('about').close();});for(let id of ['ra','dec'])$(id).addEventListener('input',()=>$('object-query').value='');$('fov').oninput=()=>$('fov-value').textContent=$('fov').value+' arcmin';
let observations, skyTarget, satelliteView, lastContextTarget;
let labView=true;
let labTarget=null;
function isCatalogStar(source){return !!source?.id&&source.xyz_pc?.length===3&&source.xyz_pc.every(Number.isFinite);}

// The SPHEREx lab is an iframe: cover it with the space loader each time it navigates.
const labFrame=$('observation-lab-frame');let labCover=null;
new MutationObserver(()=>{if(!labFrame.getAttribute('src'))return;labCover=window.SpaceLoader?.cover($('observation-lab-host'),{eyebrow:'SPHEREX VIEW · ESTABLISHING DOWNLINK',title:'Opening the SPHEREx observatory',detail:'Loading the observation lab, archive index and detector previews.'});}).observe(labFrame,{attributes:true,attributeFilter:['src']});
labFrame.addEventListener('load',()=>{labCover?.done();labCover=null;});
function setWorkspace(active){
 document.body.dataset.workspace=active;
 const embedded=active==='spherex'&&labView;
 document.body.dataset.lab=embedded?'embedded':'tools';
 $('observation-lab-host').hidden=!embedded;
 if(embedded&&!$('observation-lab-frame').hasAttribute('src'))$('observation-lab-frame').src='/observation-lab/';
 if(active!=='satellite')satelliteView?.close();
 for(const [id,name] of [['satellite-view-tab','satellite'],['observations-home','spherex'],['universe-home','context']]){
  $(id).setAttribute('aria-current',name===active?'page':'false');
 }
}
function pinTarget(point,name,source){
 const coordinates={ra:point.ra,dec:point.dec};
 skyTarget={point:coordinates,name,source};
 $('sky-target-name').textContent=name;
 $('sky-target-coordinate').textContent='ICRS '+point.ra.toFixed(5)+'°, '+point.dec.toFixed(5)+'°';
 $('sky-target-panel').hidden=false;
 $('sky-target-go').hidden=!isCatalogStar(source);
 $('sky-target-center').textContent=isCatalogStar(source)?'Center on star':'Center on sky target';
 if(scene)scene.skyTarget=skyTarget;
}
$('sky-target-observe').onclick=()=>{
 if(!skyTarget)return;
 const {point,name}=skyTarget;
 if(observations.job && Math.abs(observations.job.ra-point.ra)<1e-7 && Math.abs(observations.job.dec-point.dec)<1e-7){observations.open();return;}
 $('object-query').value='';$('ra').value=point.ra.toFixed(8);$('dec').value=point.dec.toFixed(8);
 observations.search(name);
};
$('sky-target-clear').onclick=()=>{
 skyTarget=null;
 lastContextTarget=null;
 if(scene)scene.skyTarget=null;
 $('sky-target-panel').hidden=true;
 $('sky-target-marker').hidden=true;
 $('object-strip').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
};
$('sky-target-center').onclick=()=>openTargetContext(true);
$('sky-target-go').onclick=async()=>{
 const target=skyTarget;
 const source=target?.source;
 if(!isCatalogStar(source)||!scene||scene.journey||scene.surface)return;
 const button=$('sky-target-go');
 button.disabled=true;
 try{
  if(await focusCatalogStar(source,false,target)&&skyTarget===target)await scene.approach();
 }finally{button.disabled=false;}
};
async function resolve(){let name=$('object-query').value.trim();if(!name)return;let r=await api('/api/resolve?name='+encodeURIComponent(name));$('ra').value=r.ra.toFixed(8);$('dec').value=r.dec.toFixed(8);}
$('coordinate-form').onsubmit=async e=>{e.preventDefault();try{await resolve();searchPanel(false);await observations.search($('object-query').value||'Sky field');}catch(e){toast(e.message);}};$('volume-load').onclick=async()=>{await contextView();searchPanel(false);showStars('nearby');};$('field-stars').onclick=async()=>{try{await contextView();await resolve();searchPanel(false);showStars('field');}catch(e){toast(e.message);}};$('observe-selected').onclick=()=>{let d=state.stars?.objects.find(x=>x.id===state.selected);if(d){$('object-query').value='';$('ra').value=d.ra;$('dec').value=d.dec;observations.search(d.name);}};
async function presets(){try{state.presets=await api('/api/presets');for(let p of state.presets){let b=document.createElement('button'),s=document.createElement('small');b.textContent=p.name;s.textContent=p.description;b.append(s);b.onclick=()=>{if(p.ra==null){$('object-query').value=p.simbad||p.name;toast(p.error+' Retrying name resolution.');return;}$('object-query').value='';$('ra').value=p.ra;$('dec').value=p.dec;$('fov').value=p.id==='barnard'?12:8;$('fov').oninput();searchPanel(false);observations.search(p.name);};$('presets').append(b);}}catch(e){toast(e.message);}}
const archive={prefix:'qr3/level2/',cursor:null,request:0};
async function loadArchive(more=false){
 const prefix=archive.prefix, token=++archive.request;
 const list=$('archive-list'), moreButton=$('archive-more');
 const base=$('archive-release').value+'/level2/';
 $('archive-path').textContent=prefix;
 moreButton.disabled=true;
 if(!more){archive.cursor=null;list.replaceChildren();moreButton.hidden=true;}
 try{
  const params=new URLSearchParams({prefix});
  if(more&&archive.cursor)params.set('cursor',archive.cursor);
  const result=await api('/api/archive?'+params);
  if(token!==archive.request)return;
  if(!more&&prefix!==base){
   const up=document.createElement('button');
   up.textContent='← Parent folder';
   up.onclick=()=>{archive.prefix=prefix.split('/').slice(0,-2).join('/')+'/';loadArchive();};
   list.append(up);
  }
  for(const folder of result.folders){
   const button=document.createElement('button');
   button.textContent='↳ '+folder.slice(prefix.length);
   button.onclick=()=>{archive.prefix=folder;loadArchive();};
   list.append(button);
  }
  for(const file of result.files){
   const button=document.createElement('button');
   button.textContent=file.name;
   button.onclick=()=>{searchPanel(false);observations.openFile(file.key);};
   list.append(button);
  }
  if(!result.files.length&&!result.folders.length&&!more){
   const empty=document.createElement('p');
   empty.className='micro';empty.textContent='No FITS exposures in this folder.';
   list.append(empty);
  }
  archive.cursor=result.next_cursor;
  moreButton.hidden=!archive.cursor;
 }catch(error){
  if(token===archive.request)$('archive-path').textContent=error.message;
 }finally{
  if(token===archive.request)moreButton.disabled=false;
 }
}
$('archive-release').onchange=event=>{archive.prefix=event.target.value+'/level2/';loadArchive();};
$('archive-section').ontoggle=()=>{if($('archive-section').open&&!$('archive-list').children.length)loadArchive();};
$('archive-more').onclick=()=>loadArchive(true);
$('atlas-open').onclick=async()=>{try{
 $('atlas').hidden=false;$('atlas-status').textContent='Loading the sky atlas…';
 if(!window.A){const module=await Promise.race([import('/vendor/aladin-lite.js'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Atlas initialization timed out.')),15000))]);window.A=module.default;await Promise.race([A.init,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Atlas WebGL initialization timed out.')),15000))]);}
 if(!window.skyAtlas){window.skyAtlas=A.aladin('#atlas',{survey:'P/DSS2/color',fov:10,target:'133.795129 -7.245147',showReticle:true,showLayersControl:false,showCooGrid:true,showCooGridControl:true});skyAtlas.on('click',p=>{if(p?.ra!=null&&p?.dec!=null){$('object-query').value='';$('ra').value=p.ra.toFixed(7);$('dec').value=p.dec.toFixed(7);}});skyAtlas.on('positionChanged',p=>{$('object-query').value='';$('ra').value=p.ra.toFixed(7);$('dec').value=p.dec.toFixed(7);});}
 $('atlas-status').textContent='Coordinate grid ready. Observed DSS2 tiles require access to CDS; a blank survey means tiles are unavailable. Select or pan to fill coordinates.';
 }catch(e){$('atlas-status').textContent=e.message+' Enter coordinates directly to continue.';}};

let tourActive=false;$('tour-stop').onclick=()=>{tourActive=false;observations?.stop();$('tour-view-caption').hidden=true;$('tour-stop').hidden=true;};$('tour').onclick=async()=>{if(tourActive){tourActive=false;$('tour').textContent='Start guided tour';$('tour-view-caption').hidden=true;$('tour-stop').hidden=true;return;}tourActive=true;$('tour').textContent='Stop tour';for(let p of state.presets){if(!tourActive)break;$('tour-caption').textContent=p.name+' — '+p.description;$('tour-view-caption').hidden=false;$('tour-stop').hidden=false;$('tour-view-caption').textContent=p.name+' — '+({barnard:'Look across well-separated dates with one detector.',epsilon:'A nearby brown-dwarf system; compare similar wavelengths.',wise:'Use the longest wavelengths. The faint moving-source candidate remains tentative.',rw:'A young dusty star. Wavelength differences can mimic variability.',rdraconis:'A Mira variable; compare repeated epochs at similar wavelengths.'}[p.id]||p.description);if(p.ra==null){toast(p.name+': coordinates unavailable.');continue;}$('ra').value=p.ra;$('dec').value=p.dec;$('fov').value=p.id==='barnard'?12:8;$('fov').oninput();searchPanel(false);await observations.search(p.name);await observations.waitForResult(()=>tourActive);if(!tourActive)break;await new Promise(ok=>setTimeout(ok,6000));}tourActive=false;$('tour').textContent='Start guided tour';$('tour-view-caption').hidden=true;$('tour-stop').hidden=true;observations.stop();if(observations.jobId){try{await api('/api/jobs/'+observations.jobId+'/pause',{method:'POST'});}catch{}}};
document.addEventListener('keydown',event=>{
 if($('satellite-camera')?.open)return;
 if(event.key==='Escape'){
  if(document.body.classList.contains('observing')){document.body.classList.remove('mobile-search');observations?.stop();}
  else searchPanel(false);
 }
 if(!event.ctrlKey&&!event.metaKey&&event.key==='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){
  event.preventDefault();searchPanel(true);
 }
});

$('visible-radius').onchange=filterStars;$('visible-magnitude').onchange=filterStars;
$('approach').onclick=()=>scene?.approach();
$('zoom-in').onclick=()=>zoom(.75);$('zoom-out').onclick=()=>zoom(1.33);
function zoom(f){scene?.zoomBy(f);}
$('stellar-exit').onclick=()=>scene?.smoothExit();$('stellar-surface').onclick=()=>{if(!scene?.local)return;scene.local.followPlanet=null;scene.fly(scene.controls.target.clone().set(0,0,0),scene.camera.position.clone().normalize().multiplyScalar(4.4),6500);};
window.addEventListener('scene-error',e=>toast(e.detail));
let journeyGeneration=0;
function syncSceneControls(){
 if(!scene)return;state.mode=scene.mode;
 if(scene.mode==='solar'){state.solar=scene.solarData;solarControls();strip(state.solar.objects,true);}
 else{state.stars=scene.starsData;document.body.dataset.scene='stars';$('star-filters').hidden=false;$('date').hidden=true;$('date-label').hidden=true;$('catalog-epoch').hidden=false;$('paths-toggle').hidden=true;$('solar-tab').setAttribute('aria-pressed','false');$('stars-tab').setAttribute('aria-pressed','true');$('scene-eyebrow').textContent='CATALOG / COMPUTED DEPTH';$('scene-title').textContent='Our stellar neighborhood.';$('scene-subtitle').textContent='Catalog stars and known planetary systems';$('size-note').textContent='Catalog distances in parsecs';strip(state.stars.objects,false);}
 $('inspector').hidden=false;select(scene.selected);$('return-object').hidden=!scene.traceReturn;
}
async function closeEarthSky(){
 const sky=$('earth-sky');window.skyToken=null;window.skyCleanup?.();
 if(!sky.hidden){const fade=sky.animate([{opacity:1},{opacity:0}],{duration:350});await fade.finished.catch(()=>{});sky.hidden=true;}
}
$('trace-earth').onclick=async()=>{
 const token=++journeyGeneration,data=selectedData()||{name:'Sun'};
 try{
  $('journey-panel').hidden=false;$('journey-stay').hidden=true;$('journey-exit').hidden=true;$('journey-cancel').hidden=false;
  $('journey-title').textContent='Departing for Earth';$('journey-note').textContent='Continuous illustrative flight.';document.body.classList.add('journey-active');
  if(scene.mode==='sizes')await scene.scaleTransition(()=>scene.solar(state.solar));
  const prepared=scene.readyJourneyContext;if(!prepared||prepared.selected!==state.selected)throw Error('Earth flight is not ready yet.');
  const context=prepared.context,solar=state.solar;if(token!==journeyGeneration)return;
  const reached=await scene.trace(context,solar,(title,note)=>{$('journey-title').textContent=title;$('journey-note').textContent=note;});
  if(token!==journeyGeneration)return;
  if(!reached){await scene.cancelTrace();syncSceneControls();$('journey-panel').hidden=true;document.body.classList.remove('journey-active');return;}
  syncSceneControls();$('journey-stay').hidden=false;$('journey-exit').hidden=false;$('journey-cancel').hidden=true;
  $('journey-note').textContent+=' Source constellation: '+context.constellation+'.';
 }catch(error){toast(error.message);await scene?.cancelTrace();syncSceneControls();$('journey-panel').hidden=true;document.body.classList.remove('journey-active');}
};
$('journey-exit').onclick=async()=>{
 const generation=++journeyGeneration,button=$('journey-exit');button.disabled=true;await closeEarthSky();if(generation!==journeyGeneration){button.disabled=false;return;}
 $('journey-stay').hidden=true;$('journey-cancel').hidden=false;document.body.classList.add('journey-active');$('journey-panel').hidden=false;
 try{await scene?.returnFromTrace((title,note)=>{if(generation===journeyGeneration){$('journey-title').textContent=title;$('journey-note').textContent=note;}});if(generation===journeyGeneration)syncSceneControls();}
 catch(error){if(generation===journeyGeneration){toast(error.message);await scene?.cancelTrace();syncSceneControls();}}
 finally{if(generation===journeyGeneration){$('journey-panel').hidden=true;document.body.classList.remove('journey-active');}button.disabled=false;}
};
$('journey-stay').onclick=async()=>{journeyGeneration++;await closeEarthSky();scene.stayOnEarth();syncSceneControls();$('journey-panel').hidden=true;document.body.classList.remove('journey-active');};
$('journey-cancel').onclick=async()=>{journeyGeneration++;await closeEarthSky();await scene?.cancelTrace();syncSceneControls();$('journey-panel').hidden=true;document.body.classList.remove('journey-active');};
$('return-object').onclick=()=>$('journey-exit').click();
$('activity-toggle').onclick=()=>{if(!scene)return;scene.activityEnabled=!scene.activityEnabled;$('activity-toggle').textContent='Activity '+(scene.activityEnabled?'on':'off');$('activity-toggle').setAttribute('aria-pressed',scene.activityEnabled);};


$('size-compare').onclick=async()=>{if(state.mode!=='solar')await showSolar();await scene.sizeComparison();select('sun');};
$('planet-orbit').onclick=()=>{if(state.mode==='solar')scene.planetOrbit();else if(scene.local)scene.systemOverview();else scene.approach();};
$('orbit-rate').onchange=e=>scene.orbitRate=+e.target.value;
$('star-size').oninput=e=>{if(scene)scene.starSize=+e.target.value;};
$('view-fill').oninput=e=>{scene.viewFill=+e.target.value;scene.resize();};
$('systems-toggle').onclick=()=>{observations?.close();$('systems-panel').hidden=!$('systems-panel').hidden;};
$('systems-close').onclick=()=>$('systems-panel').hidden=true;
async function loadSystems(){const home=document.createElement('button');home.className='secondary';home.textContent='Solar System · Sun, Earth and planets';home.onclick=async()=>{$('systems-panel').hidden=true;await contextView();await showSolar();};$('system-targets').append(home);
 let names=['Barnard’s Star','Epsilon Indi B','WISE 0855','RW Aurigae','R Draconis'];
 for(let [i,name] of names.entries()){let card=document.createElement('div'),title=document.createElement('p'),view=document.createElement('button'),observe=document.createElement('button');title.textContent=name;view.textContent='3D system';observe.textContent='SPHEREx images';card.append(title,view,observe);$('system-targets').append(card);view.onclick=async()=>{try{await contextView();let data=await api('/api/target-systems'),target=data.targets[i];if(!target||target.ra==null)throw Error('Catalog coordinates unavailable.');$('ra').value=target.ra;$('dec').value=target.dec;$('object-query').value='';$('systems-panel').hidden=true;if(!target.distance_pc){await showStars('field');$('scene-title').textContent=name;$('scene-subtitle').textContent='Surrounding catalog field; target depth is not established.';toast(name+': reliable target depth is unavailable; surrounding catalog sources are shown.');return;}state.mode='stars';state.stars=data;document.body.dataset.scene='stars';$('solar-tab').setAttribute('aria-pressed','false');$('stars-tab').setAttribute('aria-pressed','true');scene.stars(data,false);scene.filterRadius=Math.max(5,...data.objects.map(o=>o.distance_pc));scene.applyFilter();$('inspector').hidden=false;select(target.id);scene.controls.target.copy(scene.items.find(x=>x.data.id===target.id).pos);scene.camera.position.copy(scene.controls.target);scene.camera.position.z+=1;scene.controls.update();strip(data.objects,false);$('scene-title').textContent=name;$('scene-subtitle').textContent='Catalog system and surrounding stars · catalog distance · known planet orbits shown during close-up';$('size-note').textContent='Catalog parsec scale · photos are flat; depth comes from catalog distances';message('');}catch(e){toast(e.message);}};observe.onclick=()=>{let p=state.presets[i];if(!p?.ra){toast('Target coordinates still loading.');return;}$('ra').value=p.ra;$('dec').value=p.dec;$('systems-panel').hidden=true;observations.search(name);};}
}loadSystems();


let sceneReady=null;
async function ensureScene(){
 if(!sceneReady)sceneReady=(async()=>{const {ObservatoryScene}=await import('./scene.js?v=gaia-host');scene=new ObservatoryScene(select);scene.skyTarget=skyTarget;scene.theme(document.documentElement.dataset.theme==='light');$('activity-toggle').textContent='Activity '+(scene.activityEnabled?'on':'off');$('activity-toggle').setAttribute('aria-pressed',scene.activityEnabled);await showSolar();prefetchUniverse().catch(()=>{});})();
 try{await sceneReady;}catch(error){sceneReady=null;throw error;}
}
async function contextView(){setWorkspace('context');observations?.close();document.body.classList.remove('observing');$('observations').hidden=true;$('search-panel').hidden=true;try{if(!sceneReady)$('scene-loading').hidden=false;await ensureScene();scene.resize();}catch(e){$('scene-loading').hidden=true;message('3D is unavailable: '+e.message+'. Return to observations to continue.');}}
// Wire navigation before importing optional views or starting catalog requests.
$('universe-home').onclick=()=>contextView();
$('observation-close').onclick=()=>contextView();
let {ObservationDrawer}=await import('./observations.js?v=science-workflow');observations=new ObservationDrawer({api,toast,icon});
const openOriginal=observations.search.bind(observations);
observations.search=function(title,...args){
 if(!labView)return openOriginal(title,...args);
 const ra=Number($('ra').value),dec=Number($('dec').value);
 if(Number.isFinite(ra)&&Number.isFinite(dec))openLabField({ra,dec});
};
$('original-observation-tools').onclick=()=>{labView=false;if(observations.job)observations.open();else observations.openFeatured('vesta',null,false);};
satelliteView=installSatelliteView(observations,{
 pinTarget,
 getTarget:()=>skyTarget,
 openContext:()=>openTargetContext(true)
});
observations.open();
// Catalog availability must never gate navigation or shared-view initialization.
presets();
$('observation-close').onclick=()=>contextView();
$('search-toggle').onclick=()=>{observations.open();$('search-panel').hidden=false;document.body.classList.toggle('mobile-search');$('object-query').focus();};
$('vesta-example-open').onclick=()=>observations.openFeatured('vesta');
$('featured-field').onchange=()=>observations.openFeatured($('featured-field').value);
$('open-full-archive').onclick=()=>{
 const job=observations.job;
 if(job?.source!=='example')return;
 $('ra').value=String(job.ra);$('dec').value=String(job.dec);$('fov').value=String(job.fov);$('fov').oninput();
 observations.search(job.title);
};
$('open-tracker').onclick=()=>{
 const tools=$('ephemeris-tools');tools.open=true;tools.scrollIntoView({block:'nearest'});
 $('click-action').value='track';$('click-action').dispatchEvent(new Event('change'));
};
$('open-comparisons').onclick=()=>{
 const tools=$('exposure-coverage');tools.open=true;tools.scrollIntoView({block:'nearest'});
};
$('open-spectrum').onclick=()=>{
 const section=$('spectrum-controls');
 section.open=true;
 $('click-action').value='spectrum';$('click-action').dispatchEvent(new Event('change'));
 section.scrollIntoView({block:'nearest'});
 if(observations.current())$('measure-center-spectrum').click();
 else $('measurement-note').textContent='The spectrum is available once the first exposure loads.';
};
const params=new URLSearchParams(location.search);
if(params.has('fov')){$('fov').value=params.get('fov');$('fov').oninput();}
const validExposure=/^[0-9a-f]{24}$/.test(params.get('exposure')||'')?params.get('exposure'):null;
const chosen=params.get('example');
if([...$('featured-field').options].some(option=>option.value===chosen)){
 observations.openFeatured(chosen,validExposure,false);
}else if(params.has('ra')&&params.has('dec')){
 $('ra').value=params.get('ra');$('dec').value=params.get('dec');
 const legacy=params.get('frame');
 const frame=legacy!=null&&/^[0-9]+$/.test(legacy)&&Number.isSafeInteger(Number(legacy))?Number(legacy):null;
 observations.search('Shared sky field',frame,validExposure);
}else if(params.get('key'))observations.openFile(params.get('key'));
else if(!labView)observations.openFeatured('vesta',null,false);

function rotateSpaceVector(v,outward){let e=23.439291111*Math.PI/180,x=v.x,y=-v.z,z=v.y;if(outward)return v.set(x,Math.sin(e)*y+Math.cos(e)*z,-(Math.cos(e)*y-Math.sin(e)*z));return v.set(x,-Math.sin(e)*y+Math.cos(e)*z,-(Math.cos(e)*y+Math.sin(e)*z));}
function prefetchUniverse(){if(!cosmicReady)cosmicReady=api('/api/space?'+new URLSearchParams({ra:133.79512916666667,dec:-7.245147222222222,fov:8,scope:'nearby',radius_pc:10,include_simbad:true})).then(data=>{if(scene){scene.universeData=data;}return data;}).catch(e=>{cosmicReady=null;throw e;});return cosmicReady;}
async function nearbyExitCatalog(){
 if(scene.universeData)return scene.universeData;
 // The backdrop catalog is bundled with the app, so crossing the boundary never needs a live Gaia or SIMBAD query when it is available.
 const catalog=await scene.loadContextSky();
 const objects=catalog?.objects.filter(star=>star.distance_pc>0&&star.distance_pc<=10&&isCatalogStar(star));
 return objects?.length?{scope:'nearby',radius_pc:10,objects,unknown:[],notes:[catalog.note]}:prefetchUniverse();
}
window.addEventListener('cosmic-exit',async()=>{if(cosmicBusy||state.mode!=='solar')return;cosmicBusy=true;try{let data=await nearbyExitCatalog(),offset=rotateSpaceVector(scene.camera.position.clone(),true).multiplyScalar(1/206264.806247),up=rotateSpaceVector(scene.camera.up.clone(),true);await scene.scaleTransition(()=>{state.mode='stars';state.stars=data;document.body.dataset.scene='stars';scene.stars(data,false);scene.selected='origin';scene.controls.target.set(0,0,0);scene.camera.position.copy(offset);scene.camera.up.copy(up);scene.controls.update();select('origin');strip(data.objects,false);$('scene-title').textContent='Beyond the Solar System';$('scene-subtitle').textContent='Catalog positions · zoom toward the Sun to return';$('size-note').textContent='Catalog distances in parsecs';$('star-filters').hidden=false;});}catch(e){toast(e.message);}finally{cosmicBusy=false;}});
window.addEventListener('cosmic-enter',async()=>{if(cosmicBusy||state.mode!=='stars')return;cosmicBusy=true;let offset=rotateSpaceVector(scene.camera.position.clone(),false).normalize().multiplyScalar(55),up=rotateSpaceVector(scene.camera.up.clone(),false);try{await scene.scaleTransition(async()=>{await showSolar();scene.stopFlight();scene.selected='sun';scene.controls.target.set(0,0,0);scene.camera.position.copy(offset);scene.camera.up.copy(up);scene.controls.update();select('sun');});}finally{cosmicBusy=false;}});
window.addEventListener('catalog-context-select',event=>{
 if(scene&&!cosmicBusy&&!scene.journey&&isCatalogStar(event.detail))focusCatalogStar(event.detail);
});
window.addEventListener('cosmic-select',async event=>{if(cosmicBusy)return;cosmicBusy=true;try{let data=await prefetchUniverse();await scene.scaleTransition(()=>{state.mode='stars';state.stars=data;document.body.dataset.scene='stars';scene.stars(data,false);scene.selected=event.detail;let i=scene.items.find(i=>i.data.id===event.detail);if(i){scene.controls.target.copy(i.pos);scene.camera.position.copy(i.pos);scene.camera.position.z+=.7;}select(event.detail,false);strip(data.objects,false);$('scene-title').textContent=i?.data.name||'Catalog space';$('scene-subtitle').textContent='Catalog star · scroll or W/S to approach';});}finally{cosmicBusy=false;}});
$('universe-home').onclick=()=>contextView();
// Catalog volume is fetched only when optional 3D context is requested.

const setContextScope=installContextScopes({getScene:()=>scene,contextView,showSolar,syncSceneControls,toast});
window.parallax={state,get scene(){return scene;},get observations(){return observations;},showStars,showSolar,select,setContextScope};

$('observations-home').onclick=openSpherexTarget;
window.addEventListener('spherex-open',()=>setWorkspace('spherex'));
window.addEventListener('satellite-open',()=>{observations.close();setWorkspace('satellite');});
window.addEventListener('satellite-close',()=>{if(document.body.dataset.workspace==='satellite')contextView();});
setWorkspace('spherex');

async function observeSunSky(point){
 if(!point||!Number.isFinite(point.ra)||!Number.isFinite(point.dec))return;
 $('object-query').value='';
 $('ra').value=point.ra.toFixed(8);
 $('dec').value=point.dec.toFixed(8);
 await observations.search('Sky direction from the Sun');
}
$('sun-sky-tab').onclick=async()=>{
 await contextView();
 if(!scene)return;
 const job=observations.job;
 scene.enterSunSky(job&&Number.isFinite(job.ra)&&Number.isFinite(job.dec)?job:null);
};
$('sun-sky-center').onclick=()=>{if(scene?.sunSky)observeSunSky(scene.sunSkyDirection());};
window.addEventListener('sun-sky-observe',event=>observeSunSky(event.detail));
$('universe-home').onclick=()=>openTargetContext();

async function openTargetContext(recenter=false){
 await contextView();
 if(!scene||scene.journey||document.body.dataset.workspace!=='context')return;
 scene.leaveSunSky();
 const target=skyTarget;
 if(!target||(!recenter&&lastContextTarget===target))return;
 if(isCatalogStar(target.source)){
  if(await focusCatalogStar(target.source,true,target)&&skyTarget===target)lastContextTarget=target;
  return;
 }
 if(scene.mode==='sizes')await showSolar();
 if(skyTarget!==target)return;
 scene.centerSkyTarget();
 lastContextTarget=target;
}

async function focusCatalogStar(source,focus=true,expectedPin=null){
 if(scene.mode==='stars'&&scene.starsData){
  let item=scene.items.find(entry=>entry.data.id===source.id);
  if(!item){
   item=scene.addStar(source);
   scene.starsData.objects.push(source);
   state.stars=scene.starsData;
  }
  const onStrip=new Set([...$('object-strip').children].map(button=>button.dataset.id));
  if(!onStrip.has(source.id)){
   // Keep the existing choices when adding a star from the backdrop.
   strip(scene.starsData.objects.filter(star=>onStrip.has(star.id)||star.id===source.id),false);
  }
  select(item.data.id,focus);
  return true;
 }

 const generation=++sceneLoadGeneration;
 const catalog=await scene.loadContextSky();
 if((expectedPin&&expectedPin!==skyTarget)||generation!==sceneLoadGeneration||document.body.dataset.workspace!=='context')return false;
 const objects=catalog?.objects||scene.universeData?.objects||[];
 const distanceSquared=star=>star.xyz_pc.reduce((sum,value,index)=>sum+(value-source.xyz_pc[index])**2,0);
 const neighbors=objects.filter(star=>star.id!==source.id&&isCatalogStar(star))
  .map(star=>({star,distance:distanceSquared(star)}))
  .filter(entry=>entry.distance>1e-8)
  .sort((a,b)=>a.distance-b.distance).slice(0,18).map(entry=>entry.star);
 const data={scope:'field',objects:[source,...neighbors],unknown:[],notes:['Measured catalog positions and distances.']};
 scene.stars(data,false);
 $('visible-radius').value='1000';
 const item=scene.items.find(entry=>entry.data.id===source.id);
 scene.selected=item.data.id;
 scene.controls.target.copy(item.pos);
 scene.camera.position.copy(item.pos).add(scene.vector([0,.12,.55]));
 scene.camera.lookAt(item.pos);
 scene.controls.update();
 syncSceneControls();
 $('scene-title').textContent='Stellar neighborhood';
 $('scene-subtitle').textContent='Catalog positions and distances';
 message('');
 return true;
}
function openLabField(point){
 labView=true;
 const frame=$('observation-lab-frame');
 if(point&&(!labTarget||labTarget.ra!==point.ra||labTarget.dec!==point.dec)){
  labTarget=point;
  const q=new URLSearchParams({ra:point.ra,dec:point.dec,fov:String([5,10,15,30,60].reduce((best,n)=>Math.abs(n-(+$('fov').value||15))<Math.abs(best-(+$('fov').value||15))?n:best,15)),source:'saved'});
  frame.src='/observation-lab/?'+q;
 }
 observations.open();
}
function openSpherexTarget(){
 openLabField(skyTarget?.point);
}



const {installGuide}=await import('./guide.js?v=groq-fallbacks');
installGuide(()=>{const v=observations,point=skyTarget?.point;return {view:document.body.dataset.workspace||'spherex',target_name:skyTarget?.name||$('observation-title').textContent,ra:point?.ra??v.job?.ra??null,dec:point?.dec??v.job?.dec??null,job_id:v.jobId||null,exposure_id:v.current()?.id||null,review_id:v.sequence?.id||null,review_available:!!v.sequence?.batches_done};});

const atlasButton=$('physical-atlas-open');
atlasButton.onclick=async()=>{
 const {installCatalogAtlas}=await import('./catalog-atlas.js');
 installCatalogAtlas((point,name,redshift)=>{
  $('ra').value=point.ra.toFixed(8);$('dec').value=point.dec.toFixed(8);
  $('object-query').value='';
  observations.search(name);
  observations.atlasRedshift=Number.isFinite(redshift)?redshift:0;
 });
 atlasButton.click();
};


const catalogSearch=$('context-star-search');
catalogSearch.addEventListener('toggle',()=>{if(catalogSearch.open)scene?.loadContextSky();});
$('context-star-query').oninput=async()=>{
 const text=$('context-star-query').value.trim().toLowerCase(),display=$('context-star-results');
 display.replaceChildren();
 if(text.length<2)return;
 const catalog=await scene?.loadContextSky();
 if(text!==$('context-star-query').value.trim().toLowerCase())return;
 const matches=(catalog?.objects||[]).filter(s=>isCatalogStar(s)&&[s.name,s.id,...Object.values(s.catalog_ids||{})].join(' ').toLowerCase().includes(text)).slice(0,8);
 for(const star of matches){
  const button=document.createElement('button');button.type='button';button.textContent=star.name;
  button.onclick=()=>focusCatalogStar(star);
  display.append(button);
 }
 if(!matches.length)display.textContent='No match in the installed catalog.';
};
