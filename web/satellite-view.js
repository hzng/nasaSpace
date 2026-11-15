import {loadCatalogSky} from './satellite-stars.js?v=1';

// A fixed detector viewpoint for the exposure selected in Images.
export function fitDetector(bounds, width, height) {
  const scale = Math.min(width / (bounds.right - bounds.left), height / (bounds.top - bounds.bottom));
  const w = (bounds.right - bounds.left) * scale, h = (bounds.top - bounds.bottom) * scale;
  const left = (width - w) / 2, top = (height - h) / 2;
  return {
    left, top, w, h, scale,
    screen(x, y) { return [left + (x - bounds.left) * scale, top + (bounds.top - y) * scale]; },
    pixel(x, y) {
      if (x < left || x > left + w || y < top || y > top + h) return null;
      return [bounds.left + (x - left) / scale, bounds.top - (y - top) / scale];
    }
  };
}

const radians = Math.PI / 180;
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const catalogVectors = new WeakMap();
const scaleVector = (vector, factor) => vector.map(value => value * factor);
const add = (a, b) => a.map((value, i) => value + b[i]);
const unit = vector => scaleVector(vector, 1 / Math.hypot(...vector));
const orthogonal = (vector, axis) => add(vector, scaleVector(axis, -dot(vector, axis)));
const skyVector = ({ra, dec}) => [
  Math.cos(dec * radians) * Math.cos(ra * radians),
  Math.cos(dec * radians) * Math.sin(ra * radians),
  Math.sin(dec * radians)
];

function cameraBasis(data) {
  const forward = skyVector(data.detector_center);
  const right = unit(orthogonal(skyVector(data.camera_right), forward));
  const up = unit(orthogonal(orthogonal(skyVector(data.camera_up), forward), right));
  return {forward, right, up};
}

function aimAt(camera, target) {
  const forward = skyVector(target);
  // Preserve the detector roll while turning to the selected sky direction.
  const alignment = dot(camera.forward, forward);
  const tangent = orthogonal(forward, camera.forward);
  const sine = Math.hypot(...tangent);
  if (sine < 1e-10) {
    return alignment > 0 ? camera : {forward, right: scaleVector(camera.right, -1), up: camera.up};
  }
  const toward = scaleVector(tangent, 1 / sine);
  function rotate(vector) {
    const a = dot(vector, camera.forward), b = dot(vector, toward);
    return add(vector, add(scaleVector(camera.forward, (alignment - 1) * a - sine * b),
      scaleVector(toward, sine * a + (alignment - 1) * b)));
  }
  return {forward, right: rotate(camera.right), up: rotate(camera.up)};
}

function screenPosition(camera, sky, width, height, focal) {
  const vector = catalogVectors.get(sky) || skyVector(sky);
  const depth = dot(vector, camera.forward);
  if (depth <= 0) return null;
  return [width / 2 + focal * dot(vector, camera.right) / depth,
    height / 2 - focal * dot(vector, camera.up) / depth];
}

function rotatePair(first, second, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [add(scaleVector(first, cosine), scaleVector(second, sine)),
    add(scaleVector(first, -sine), scaleVector(second, cosine))];
}

export function skyRay(camera, x, y) {
  const [a, b, c] = add(add(camera.forward, scaleVector(camera.right, x)), scaleVector(camera.up, y));
  return {ra: (Math.atan2(b, a) / radians + 360) % 360, dec: Math.atan2(c, Math.hypot(a, b)) / radians};
}

export function installSatelliteView(view, {pinTarget, openContext, getTarget} = {}) {
  const byId = id => document.getElementById(id);
  const dialog = document.createElement('dialog');
  dialog.id = 'satellite-camera';
  dialog.setAttribute('aria-labelledby', 'satellite-camera-title');
  dialog.innerHTML = `
    <div class="satellite-heading">
      <h2 id="satellite-camera-title">Satellite View</h2>
      <button type="button" id="satellite-close">Close</button>
    </div>
    <p id="satellite-exposure"></p>
    <p class="micro"><a id="satellite-source" target="_blank" rel="noreferrer" hidden></a></p>
    <div class="satellite-controls">
      <button type="button" id="satellite-loaded" aria-pressed="true">Loaded cutout</button>
      <button type="button" id="satellite-full" aria-pressed="false">Detector footprint</button>
      <button type="button" id="satellite-look" aria-pressed="false">Look around</button>
      <button type="button" id="satellite-target">Center target</button>
      <button type="button" id="satellite-search">Search view center</button>
      <button type="button" id="satellite-context" disabled>Open in 3D Context</button>
      <label>Look-around field <select id="satellite-fov"><option value="90">90°</option><option value="60" selected>60°</option><option value="30">30°</option><option value="15">15°</option></select></label>
    </div>
    <div class="satellite-catalog"><label>Find a catalog star<input id="satellite-star-query" type="search" placeholder="Name or catalog ID, e.g. Sirius, HIP 71683"></label><label>Catalog<select id="satellite-star-source"><option value="all">All sources</option><option value="expanded">Added catalog stars</option><option value="Gaia DR3">Teammate Gaia DR3 sample</option><option value="Gliese">Gliese nearby stars</option><option value="Yale">Yale bright stars</option><option value="Hipparcos">Hipparcos</option><option value="NASA">NASA exoplanet hosts</option></select></label><span id="satellite-catalog-count" class="micro"></span><div id="satellite-star-results"></div></div>
    <div class="satellite-stage">
      <canvas id="satellite-sky" width="960" height="540" aria-hidden="true" hidden></canvas>
      <canvas id="satellite-detector" width="960" height="540" tabindex="0" aria-label="SPHEREx sky view. Use arrow keys to look around."></canvas>
    </div>
    <p id="satellite-detail" class="micro"></p>
    <p id="satellite-status" role="status"></p>`;
  document.body.append(dialog);
  const canvas = byId('satellite-detector'), ctx = canvas.getContext('2d');
  const status = byId('satellite-status'), sky = byId('satellite-sky');
  const modes = ['loaded', 'full', 'look'];
  const focalFor = degrees => canvas.width / (2 * Math.tan(degrees * radians / 2));
  const defaultFocal = focalFor(60);
  let focal = defaultFocal;
  let data, pixels, selection, projection, camera, drag, catalogDraw, catalogLoad, catalogFailed;
  let target, targetName, turn = 0, mode = 'look', request = 0, resolving = false;
  let catalog = [], catalogRequest, visibleStars = [], frameTarget;

  function openCatalog() {
    if (!catalogRequest) {
      catalogRequest = view.api('/api/context-sky').then(result => {
        catalog = result.objects.filter(source => Number.isFinite(source.ra) && Number.isFinite(source.dec))
          .sort((a, b) => a.distance_pc - b.distance_pc);
        for (const source of catalog) catalogVectors.set(source, skyVector(source));
        byId("satellite-catalog-count").textContent=catalog.length.toLocaleString()+" catalog sources · "+(result.added_stars||0)+" additions";
        findStars();
        if (dialog.open) draw();
      }).catch(() => { catalogRequest = null; });
    }
    if (catalogLoad) return;
    catalogFailed = false;
    const skyCover = window.SpaceLoader?.cover(dialog.querySelector('.satellite-stage'), {
      eyebrow: 'SATELLITE VIEW · ACQUIRING SKY', title: 'Loading the catalog sky',
      detail: 'Streaming the 4K Deep Star Maps texture and catalog star directions.'});
    const skyTask = window.SpaceLoader?.begin('Loading catalog sky texture');
    catalogLoad = loadCatalogSky(sky).then(render => { catalogDraw = render; }).catch(() => {
      catalogFailed = true;
      catalogLoad = null;
    }).finally(() => { skyCover?.done(); skyTask?.end(); if (dialog.open) draw(); });
  }

  function chooseSource(source){
    target=source;targetName=source.name;mode='look';
    pinTarget?.(source,source.name,source);status.textContent=source.name+' · '+source.catalog+' · '+source.distance_pc.toFixed(2)+' pc';
    centerTarget();
  }
  function findStars(){
    const query=byId('satellite-star-query').value.trim().toLowerCase(),filter=byId('satellite-star-source').value;
    const matches=catalog.filter(source=>(filter==='all'||filter==='expanded'&&source.expanded_catalog||source.catalog?.includes(filter))&&(!query||(source.name+' '+source.id+' '+Object.entries(source.catalog_ids||{}).map(([k,v])=>k+' '+v).join(' ')).toLowerCase().includes(query)));
    const results=byId('satellite-star-results');results.replaceChildren();
    for(const source of matches.slice(0,query?8:5)){const b=document.createElement('button');b.textContent=source.name;b.title=source.catalog+' · '+source.distance_pc.toFixed(2)+' pc';b.onclick=()=>chooseSource(source);results.append(b);}
    if(query&&!matches.length)results.textContent='No match in the installed catalog subset.';
  }
  byId('satellite-star-query').oninput=findStars;
  byId('satellite-star-source').onchange=findStars;
  function centerTarget() {
    cancelAnimationFrame(turn);
    const start = camera;
    const end = aimAt(start, target);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const began = performance.now();
    const cosine = Math.max(-1, Math.min(1, dot(start.forward, end.forward)));
    const arc = Math.acos(cosine);
    const tangent = cosine < -.9999999 ? start.right : orthogonal(end.forward, start.forward);
    function step(now) {
      if (mode !== 'look' || !dialog.open) return;
      const progress = reduced ? 1 : Math.min(1, (now - began) / 550);
      const ease = progress * progress * (3 - 2 * progress);
      if (progress === 1 || arc < 1e-8) camera = end;
      else {
        const ray = add(scaleVector(start.forward, Math.cos(ease * arc)), scaleVector(unit(tangent), Math.sin(ease * arc)));
        camera = aimAt(start, skyRay({forward: ray, right: start.right, up: start.up}, 0, 0));
        turn = requestAnimationFrame(step);
      }
      draw();
    }
    turn = requestAnimationFrame(step);
  }

  function drawSkyGrid() {
    ctx.strokeStyle = '#344b61';
    function curve(coords) {
      ctx.beginPath();
      let connected = false;
      for (const position of coords) {
        const vector = skyVector(position);
        const depth = dot(vector, camera.forward);
        if (depth < .1) {
          connected = false;
          continue;
        }
        const x = canvas.width / 2 + focal * dot(vector, camera.right) / depth;
        const y = canvas.height / 2 - focal * dot(vector, camera.up) / depth;
        if (connected) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        connected = true;
      }
      ctx.stroke();
    }
    for (let dec = -75; dec <= 75; dec += 15) {
      curve(Array.from({length: 121}, (_, i) => ({ra: i * 3, dec})));
    }
    for (let ra = 0; ra < 360; ra += 15) {
      curve(Array.from({length: 61}, (_, i) => ({ra, dec: i * 3 - 90})));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sky.hidden = true;
    visibleStars = [];
    if (!camera) return;
    for (const name of modes) byId('satellite-' + name).setAttribute('aria-pressed', String(mode === name));
    canvas.classList.toggle('looking', mode === 'look');
    byId('satellite-fov').disabled = mode !== 'look';
    byId('satellite-target').disabled = !target;
    byId('satellite-context').disabled = !target;
    if (mode === 'look') {
      const hasCatalog = catalogDraw?.(camera, focal);
      sky.hidden = !hasCatalog;
      if (!hasCatalog) {
        ctx.fillStyle = '#080e18';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawSkyGrid();
      }
      drawCatalogStars();
      crosshair(canvas.width / 2, canvas.height / 2);
      if (target) drawTarget(screenPosition(camera, target, canvas.width, canvas.height, focal));
      showCenter(skyRay(camera, 0, 0), hasCatalog
        ? 'Catalog sky · NASA Goddard SVS. Click a marked catalog star to select it. Right-click a direction to search SPHEREx.'
        : catalogFailed ? 'Catalog map unavailable. Drag the coordinate grid or right-click to search SPHEREx.'
          : 'Loading the catalog sky. Right-click to search SPHEREx.');
      return;
    }
    if (!data || !pixels) return;
    const full = mode === 'full';
    const [ox, oy] = full ? data.detector_offset : [0, 0];
    const bounds = {
      left: -.5 - ox, bottom: -.5 - oy,
      right: (full ? data.detector_size : data.width) - .5 - ox,
      top: (full ? data.detector_size : data.height) - .5 - oy
    };
    projection = fitDetector(bounds, canvas.width, canvas.height);
    const {left, top, w, h, scale} = projection;
    ctx.fillStyle = '#192431';
    ctx.fillRect(left, top, w, h);
    const [x, y] = projection.screen(-.5, data.height - .5);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixels, x, y, data.width * scale, data.height * scale);
    ctx.strokeStyle = '#748ca3';
    ctx.strokeRect(left + .5, top + .5, w - 1, h - 1);
    if (full) {
      ctx.strokeStyle = '#ffcd81';
      ctx.strokeRect(x, y, data.width * scale, data.height * scale);
    }
    crosshair(left + w / 2, top + h / 2);
    if (data.target_pixel && target && target === frameTarget) {
      const [tx, ty] = projection.screen(...data.target_pixel);
      if (tx >= left && tx <= left + w && ty >= top && ty <= top + h) drawTarget([tx, ty]);
    }
    showCenter(full ? data.detector_center : data.crop_center, full
      ? 'The amber box marks the loaded cutout. The rest of the detector is outside this cutout.'
      : 'Archived detector orientation. Invalid pixels are masked.');
  }

  function drawCatalogStars() {
    ctx.fillStyle = '#b5d0f2';
    ctx.beginPath();
    for (const source of catalog) {
      const point = screenPosition(camera, source, canvas.width, canvas.height, focal);
      if (!point) continue;
      const [x, y] = point;
      if (x < -3 || y < -3 || x > canvas.width + 3 || y > canvas.height + 3) continue;
      visibleStars.push({source, point});
      ctx.moveTo(x + 2.5, y);
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  function selectStar(point) {
    let best, distance = 13;
    for (const star of visibleStars) {
      const d = Math.hypot(star.point[0] - point[0], star.point[1] - point[1]);
      if (d < distance) {
        best = star.source;
        distance = d;
      }
    }
    if (!best) return;
    target = best;
    targetName = best.name;
    pinTarget?.(target, targetName, best);
    status.textContent = best.name + ' · ' + best.catalog + ' · select Open in 3D Context to focus this star.';
    draw();
  }

  function drawTarget(point) {
    if (!point) return;
    const [x, y] = point;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = '#05080e';
    ctx.shadowBlur = 5;
    ctx.strokeStyle = ctx.fillStyle = '#ffc680';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = quarter * Math.PI / 2;
      ctx.moveTo(19 * Math.cos(angle + .17), 19 * Math.sin(angle + .17));
      ctx.arc(0, 0, 19, angle + .17, angle + Math.PI / 2 - .17);
      ctx.moveTo(22 * Math.cos(angle), 22 * Math.sin(angle));
      ctx.lineTo(28 * Math.cos(angle), 28 * Math.sin(angle));
    }
    ctx.stroke();
    ctx.font = '600 15px system-ui';
    ctx.textAlign = x > canvas.width * .68 ? 'right' : 'left';
    ctx.fillText(targetName, ctx.textAlign === 'right' ? -34 : 34, 5, canvas.width * .31);
    ctx.restore();
  }

  function crosshair(cx, cy) {
    ctx.strokeStyle = '#e3edf5';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
    ctx.stroke();
  }

  function showCenter(sky, message) {
    byId('satellite-detail').textContent = 'Center RA ' + sky.ra.toFixed(5) +
      '°, Dec ' + sky.dec.toFixed(5) + '°. ' + message;
  }

  async function search(point) {
    if (!camera || resolving || !point || (mode !== 'look' && !data)) return;
    cancelAnimationFrame(turn);
    const token = request;
    resolving = true;
    status.textContent = 'Finding the sky coordinates…';
    status.classList.add('sl-inline-busy');
    try {
      const [x, y] = point;
      const coords = mode === 'look'
        ? skyRay(camera, (x - canvas.width / 2) / focal, (canvas.height / 2 - y) / focal)
        : await view.api(selection.url + '/direction?' + new URLSearchParams({x, y, exposure_id: selection.id}));
      if (token !== request || !dialog.open) return;
      pinTarget?.(coords, 'Selected sky direction');
      byId('object-query').value = '';
      byId('ra').value = coords.ra.toFixed(8);
      byId('dec').value = coords.dec.toFixed(8);
      dialog.close();
      await view.search('Sky direction from SPHEREx');
    } catch (error) {
      if (token === request) status.textContent = error.message;
    } finally {
      if (token === request) resolving = false;
      status.classList.remove('sl-inline-busy');
    }
  }

  byId('satellite-close').onclick = () => dialog.close();
  byId('satellite-fov').onchange = event => {
    focal = focalFor(Number(event.target.value));
    draw();
  };
  byId('satellite-context').onclick = () => {
    if (!target || resolving) return;
    dialog.close();
    openContext?.();
  };
  for (const name of modes) byId('satellite-' + name).onclick = () => {
    if (resolving) return;
    mode = name;
    if (name === 'look') openCatalog();
    status.textContent = name === 'look' ? 'Right-click any direction to search the archive.'
      : 'Right-click a direction inside the detector to search the archive.';
    draw();
  };
  byId('satellite-target').onclick = () => {
    if (!camera || !target || resolving) return;
    mode = 'look';
    status.textContent = '';
    openCatalog();
    centerTarget();
  };
  function pointAt(x, y) {
    return mode === 'look' ? [x, y] : projection?.pixel(x, y);
  }
  byId('satellite-search').onclick = () => search(pointAt(canvas.width / 2, canvas.height / 2));
  dialog.addEventListener('close', () => {
    if (!dialog.open) {
      cancelAnimationFrame(turn);
      request++;
      drag = null;
      window.dispatchEvent(new Event('satellite-close'));
    }
  });
  function canvasPoint(event) {
    const box = canvas.getBoundingClientRect();
    return [
      (event.clientX - box.left) * canvas.width / box.width,
      (event.clientY - box.top) * canvas.height / box.height];
  }
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    const point = pointAt(...canvasPoint(event));
    if (point) search(point);
    else if (projection) status.textContent = 'Choose a point inside the detector border.';
  });
  canvas.addEventListener('pointerdown', event => {
    if (mode !== 'look' || event.button !== 0) return;
    cancelAnimationFrame(turn);
    const point = canvasPoint(event);
    drag = {id: event.pointerId, point, start: point, moved: false};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (mode !== 'look' || event.pointerId !== drag?.id) return;
    const point = canvasPoint(event);
    if (!drag.moved && Math.hypot(point[0] - drag.start[0], point[1] - drag.start[1]) < 5) return;
    drag.moved = true;
    look((drag.point[0] - point[0]) / focal, (point[1] - drag.point[1]) / focal);
    drag.point = point;
  });
  canvas.addEventListener('pointerup', event => {
    if (mode === 'look' && drag?.id === event.pointerId && !drag.moved) selectStar(canvasPoint(event));
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => {
    if (!camera || mode !== 'look') return;
    event.preventDefault();
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.height : 1;
    focal = Math.max(focalFor(110), Math.min(focalFor(12),
      focal * Math.exp(-event.deltaY * multiplier * .001)));
    const degrees = 2 * Math.atan(canvas.width / (2 * focal)) / radians;
    const presets = Array.from(byId('satellite-fov').options);
    const choice = presets.find(option => Math.abs(Number(option.value) - degrees) < .5);
    byId('satellite-fov').value = choice?.value || '';
    draw();
  }, {passive: false});
  function look(horizontal, vertical) {
    [camera.forward, camera.right] = rotatePair(camera.forward, camera.right, horizontal);
    [camera.forward, camera.up] = rotatePair(camera.forward, camera.up, vertical);
    draw();
  }
  canvas.addEventListener('keydown', event => {
    const moves = {ArrowLeft: [-.08,0], ArrowRight: [.08,0], ArrowUp: [0,.08], ArrowDown: [0,-.08]};
    if (!camera || mode !== 'look' || !Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    cancelAnimationFrame(turn);
    look(...moves[event.key]);
  });

  async function open() {
    const token = ++request;
    view.stop();
    const saved = getTarget?.();
    const next = saved?.point;
    const changed = next && (!target || Math.abs(target.ra-next.ra)>1e-7 || Math.abs(target.dec-next.dec)>1e-7);
    target = next;
    targetName = saved?.name;
    if (!camera) {
      const initial = target || {ra: 133.79512916666667, dec: -7.245147222222222};
      camera = aimAt({forward:[1,0,0],right:[0,1,0],up:[0,0,1]}, initial);
    } else if (changed) camera = aimAt(camera, target);
    resolving = false;
    mode = 'look';
    byId('satellite-look').disabled = false;
    byId('satellite-search').disabled = false;
    const frame = view.current();
    const usable = frame && view.jobId && view.job && (!target ||
      (Math.abs(view.job.ra-target.ra)<1e-6 && Math.abs(view.job.dec-target.dec)<1e-6));
    const nextSelection = usable ? {id:frame.id,url:'/api/jobs/'+view.jobId+'/satellite-view/'+frame.index} : null;
    if (nextSelection?.id !== selection?.id || nextSelection?.url !== selection?.url) data = pixels = projection = null;
    selection = nextSelection;
    byId('satellite-loaded').disabled = !data;
    byId('satellite-full').disabled = !data?.detector_offset;
    byId('satellite-source').hidden = true;
    byId('satellite-exposure').textContent = 'Free sky perspective · catalog directions. No live spacecraft position or attitude is implied.';
    status.textContent = 'Drag to explore, select a star, or right-click to open its infrared field.';
    if (!dialog.open) dialog.show();
    window.dispatchEvent(new Event('satellite-open'));
    openCatalog();
    draw();
    if (!selection) return;
    const stage = dialog.querySelector('.satellite-stage');
    const frameTask = data ? null : window.SpaceLoader?.begin('Downloading detector frame');
    if (frameTask) { stage.classList.add('sl-scanning'); status.textContent = 'Downloading the SPHEREx detector frame…'; status.classList.add('sl-inline-busy'); }
    try {
      const result = data || await view.api(selection.url+'?'+new URLSearchParams({exposure_id:selection.id}));
      const image = pixels || new Image();
      if (!pixels) { frameTask?.set('Decoding detector pixels'); image.src=result.image; await image.decode(); }
      if (token!==request || !dialog.open) return;
      data=result; pixels=image; frameTarget=result.target??result.crop_center;
      if (target && Math.abs(target.ra-frameTarget.ra)<1e-7 && Math.abs(target.dec-frameTarget.dec)<1e-7) target=frameTarget;
      const position=result.spacecraft;
      byId('satellite-exposure').textContent=result.date+' · Detector '+result.detector+'. '+(position?'Recorded spacecraft '+position.sample+' at '+position.time+'.':'Spacecraft position is unavailable for this exposure.')+' Free look is illustrative.';
      if (result.archive_url?.startsWith('https://')) {
        const source=byId('satellite-source'); source.href=result.archive_url;
        source.textContent='Original exposure · '+(result.observation||result.date); source.hidden=false;
      }
      byId('satellite-loaded').disabled=false;
      byId('satellite-full').disabled=!result.detector_offset;
      if (frameTask) status.textContent = 'Drag to explore, select a star, or right-click to open its infrared field.';
      draw();
    } catch(error) {
      if(token===request) status.textContent='Detector image unavailable: '+error.message+' You can still explore the sky.';
    } finally {
      frameTask?.end(); stage.classList.remove('sl-scanning'); status.classList.remove('sl-inline-busy');
    }
  }
  byId('satellite-view-tab').onclick = open;
  return {open,close:()=>dialog.open&&dialog.close(),get direction(){return camera?skyRay(camera,0,0):null;}};
}
