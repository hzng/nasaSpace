"use strict";
const $ = id => document.getElementById(id);
const state = { library: null, session: null, index: 0, reference: 0, mode: "single",
  zoom: 1, panX: 0, panY: 0, point: null, timer: null, loading: false, images: new Map(),
  maskCache: new Map(), hoverCache: new Map(),
  drawVersion: 0, inspectVersion: 0, title: "Vesta", field: "vesta", objectContext: null,
  requestVersion: 0, pending: null, views: new Map() };
const hues = ["#b798f4", "#84b3ef", "#a5edcc", "#ebdf82", "#eec083", "#efac99"];
const dateText = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const timeText = timestamp => new Date(timestamp).toISOString().slice(11, 16);
const numberText = (value, digits=3) => value == null ? "Unavailable" : Number(value).toFixed(digits);

async function api(path, options={}) {
  const response = await fetch(path, options);
  // A tunnel or proxy answers with an HTML error page while the server is down.
  const data = await response.json().catch(() => {
    throw new Error("The server did not answer. It may be restarting. Try again in a moment.");
  });
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function status(message, kind="") {
  $("status").textContent = message;
  $("status").className = `status ${kind}`;
}

function entryList(parent, entries) {
  parent.replaceChildren();
  for (const [label, value] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    parent.append(row);
  }
}

function imageFor(url) {
  if (!state.images.has(url)) {
    state.images.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A preview could not be loaded."));
      image.src = url;
    }));
  }
  return state.images.get(url);
}

function transform(canvas) {
  const rect = canvas.getBoundingClientRect();
  const side = Math.min(rect.width, rect.height) * state.zoom;
  return { side, left: (rect.width-side)/2 + state.panX*rect.width,
    top: (rect.height-side)/2 + state.panY*rect.height, width: rect.width, height: rect.height };
}

function markLabel(ctx, text, x, y, color) {
  ctx.save();
  ctx.font = "600 12px Segoe UI";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(10,11,14,.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawCenter(ctx, x, y) {
  ctx.save();
  ctx.globalAlpha = .8; ctx.strokeStyle = "#d9d4c8"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x-8,y); ctx.lineTo(x+8,y); ctx.moveTo(x,y-8); ctx.lineTo(x,y+8); ctx.stroke();
  ctx.restore();
}

// Where the selected target is expected in this frame before any tracking: the archived Vesta
// prediction, or the centre of a saved star field. An expected position, not a measurement.
// ICRS position at epoch J2000 (deg) and proper motion (mas/yr, RA term includes cos Dec), SIMBAD 2026-11-13.
// These targets move a SPHEREx pixel or more per year, so a saved field centre does not stay on them.
const MOVERS = {
  barnard: [269.4520769586, 4.6933649666, -801.551, 10362.394],
  "epsilon-indi": [331.0441465885, -56.7828441951, 3981.977, -2466.832],
  "wise-0855": [133.81890825, -7.247048, -8123.7, 673.2],
};
function targetAt(frame) {
  // A Horizons track draws its own named box on Vesta, so the expected-position box steps aside
  if (frame.marker) return typeof StarTracker !== "undefined" && Object.keys(StarTracker.kinds()).length ? null : frame.marker;
  if (state.field === "custom" || state.field === "vesta") return null;
  const m = MOVERS[state.field];
  if (!m) return [.5,.5];
  // shortcut: flat-sky offset from the view centre, exact to well under a pixel within a few arcmin; use a TAN projection if a target ever sits far from centre
  const {ra, dec, fov} = state.session.options, years = (new Date(frame.timestamp) - Date.UTC(2000,0,1,12)) / 31557600000;
  const east = (m[0]-ra)*Math.cos(m[1]*Math.PI/180)*3600 + m[2]*years/1000, north = (m[1]-dec)*3600 + m[3]*years/1000;  // arcsec
  const x = .5 - east/(fov*60), y = .5 - north/(fov*60);
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : [x,y];
}

function drawTarget(ctx, x, y) {
  ctx.strokeStyle = "#eab354"; ctx.lineWidth = 1.6;
  ctx.strokeRect(x-21,y-21,42,42);
  markLabel(ctx, state.title, x-21, y+36, "#eab354");  // below the box: tracker labels sit above it
}

function drawClick(ctx, x, y) {
  ctx.strokeStyle = "#6cb8ff"; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { ctx.moveTo(x+dx*4,y+dy*4); ctx.lineTo(x+dx*11,y+dy*11); }
  ctx.stroke();
}

// Keyboard crosshair: chrome focus colour, not a data colour, so it never reads as a measurement.
function drawCursor(ctx, x, y) {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim() || "#fff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x-6,y-6,12,12);
  ctx.beginPath(); ctx.moveTo(x-1,y); ctx.lineTo(x+1,y); ctx.moveTo(x,y-1); ctx.lineTo(x,y+1); ctx.stroke();
}

const legendGlyphs = {
  center: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M4 11h14M11 4v14" stroke="#d9d4c8" stroke-opacity=".8" stroke-width="1" fill="none"/></svg>',
  click: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M11 3v5M11 14v5M3 11h5M14 11h5" stroke="#6cb8ff" stroke-width="1.6" fill="none"/></svg>',
  guide: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><rect x="4" y="4" width="14" height="14" stroke="#eab354" stroke-width="1.6" fill="none"/></svg>',
  measured: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="#68d391" stroke-width="1.8" fill="none"/></svg>',
  wing: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="#71d9f6" stroke-width="1.8" fill="none"/></svg>',
  predicted: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="#b9a3f5" stroke-width="1.8" stroke-dasharray="3.5 3" fill="none"/></svg>',
  path: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M2 15L20 7" stroke="#b9a3f5" stroke-width="1.4" stroke-dasharray="3.5 2.5" fill="none"/><circle cx="6" cy="13.3" r="2.2" fill="#b9a3f5"/><circle cx="16" cy="8.9" r="2.2" fill="#b9a3f5"/></svg>',
};

// One legend for every mark; shows only what is currently drawn.
function updateLegend() {
  const box = $("guide-legend");
  if (!box) return;
  const frame = state.session?.frames?.[state.index];
  const items = [];
  if (frame && $("markers").checked) {
    items.push(["center","Field center"]);
    if (targetAt(frame)) items.push(["guide",`${state.title} · expected position, not measured`]);
  }
  if (frame && state.point) items.push(["click","Clicked pixel"]);
  const kinds = frame && typeof StarTracker !== "undefined" ? StarTracker.kinds() : {};
  if (kinds.measured) items.push(["measured","Measured"]);
  if (kinds.wing) items.push(["wing","Wing fit"]);
  if (kinds.predicted) items.push(["predicted","Predicted (catalog or ephemeris)"]);
  if (kinds.path) items.push(["path","Predicted path \u00b7 click a dot for details"]);
  box.replaceChildren(...items.map(([key,label]) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = legendGlyphs[key];
    item.append(label);
    return item;
  }));
  box.hidden = !items.length;
}

async function paint(canvas, frame, version) {
  if (canvas.parentElement.hidden) return;
  const [image, mask] = await Promise.all([imageFor(frame.preview),
    $("quality").checked ? imageFor(frame.quality_overlay) : Promise.resolve(null)]);
  if (version !== state.drawVersion) return;
  const {side, left, top, width, height} = transform(canvas);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width*ratio);
  canvas.height = Math.round(height*ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image,left,top,side,side);
  if ($("tint").checked) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = .25;
    ctx.fillStyle = hues[frame.detector-1];
    ctx.fillRect(left,top,side,side);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  if (mask) ctx.drawImage(mask,left,top,side,side);
  if ($("markers").checked) {
    drawCenter(ctx,left+.5*side,top+.5*side);
    const at = targetAt(frame);
    if (at) drawTarget(ctx,left+at[0]*side,top+at[1]*side);
    // Vesta crosses this fixed patch in under a day: say where it went instead of drawing nothing
    else if (state.field === "vesta" && !frame.marker && !(typeof StarTracker !== "undefined" && Object.keys(StarTracker.kinds()).length)) {
      const days = [...new Set(state.session.frames.filter(f => f.marker).map(f => dateText(f.timestamp)))];
      markLabel(ctx, "Vesta is not in this frame", left+12, top+66, "#eab354");
      markLabel(ctx, days.length ? `It crosses this patch on ${days.join(" and ")}` : "No frame in this band shows it. Try D3 or D6.", left+12, top+82, "#eab354");
    }
  }
  if (state.point) drawClick(ctx,left+state.point.x*side,top+state.point.y*side);
  if (state.cursor?.id === canvas.id) drawCursor(ctx,left+state.cursor.x*side,top+state.cursor.y*side);
  if (typeof StarTracker !== "undefined") StarTracker.paint(ctx, frame, {side,left,top});
}

async function draw() {
  if (!state.session?.frames.length) return;
  const version = ++state.drawVersion;
  try {
    await Promise.all([paint($("sky"), state.session.frames[state.index], version),
      paint($("reference"), state.session.frames[state.reference], version)]);
  } catch(error) { status(error.message,"error"); }
}

function stop() {
  clearInterval(state.timer);
  state.timer = null;
  if ($("play-label")) $("play-label").textContent = "Play";
  $("play").setAttribute("aria-pressed","false");
}

function play() {
  if (state.timer) { stop(); return; }
  if (!state.session || state.session.frames.length < 2 || state.loading) return;
  if ($("play-label")) $("play-label").textContent = "Pause";
  $("play").setAttribute("aria-pressed","true");
  state.timer = setInterval(() => setFrame((state.index+1)%state.session.frames.length), Number($("speed").value));
}

function renderComparison() {
  const frames = state.session.frames;
  if (!frames.length) return;
  const first = frames[state.index];
  const second = frames[state.reference];
  const span = (new Date(frames.at(-1).timestamp)-new Date(frames[0].timestamp))/86400000;
  $("baseline").textContent = `${frames.length} obs · ${span.toFixed(1)}d`;
  const waves = frames.map(frame => frame.wavelength).filter(value => value != null);
  const releases = [...new Set(frames.map(frame => frame.release))].join("/");
  $("comparison-note").textContent = state.mode === "split"
    ? `${dateText(first.timestamp)} vs ${dateText(second.timestamp)}`
    : (waves.length ? `${Math.min(...waves).toFixed(2)}–${Math.max(...waves).toFixed(2)} µm · ${releases}` : `Outside center · ${releases}`);
  $("frame-caption").textContent = `${dateText(first.timestamp)} · D${first.detector}`;
  $("reference-caption").textContent = `${dateText(second.timestamp)} · D${second.detector}`;
  $("frame-caption").style.setProperty("--swatch", `var(--d${first.detector})`);
  $("reference-caption").style.setProperty("--swatch", `var(--d${second.detector})`);
}

function setFrame(index) {
  if (!state.session?.frames.length || state.loading) return;
  state.index = index;
  const frame = state.session.frames[index];
  $("timeline").value = index;
  $("timeline").setAttribute("aria-valuetext", dateText(frame.timestamp));
  if ($("frame-counter")) $("frame-counter").textContent = `Frame ${index+1} / ${state.session.frames.length}`;
  $("observation-date").textContent = new Date(frame.timestamp).toLocaleDateString("en",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  $("observation-time").textContent = `${frame.timestamp.slice(11,19)} UTC`;
  entryList($("metadata"), [
    ["Obs ID",frame.id],
    ["Band",`D${frame.detector} · ${frame.release}`],
    ["Wavelength", frame.wavelength == null ? "Out of bounds" : `${frame.wavelength.toFixed(3)} µm`],
    ["Valid data",`${frame.coverage}%`],
    ["Exposure",`${frame.exposure.toFixed(1)} s`],
    ["Pipeline",frame.version],
  ]);
  const headline = document.createElement("strong");
  headline.textContent = `${frame.caution_fraction}% flagged`;
  const detail = document.createElement("span");
  detail.textContent = $("quality").checked ? "Overlay on · click to hide" : "Click to preview mask";
  const chips = document.createElement("span");  // span: the card is a <button>, which allows phrasing content only
  chips.className = "flag-chip-list";
  for (const item of (frame.flag_summary || []).slice(0, 4)) {
    const chip = document.createElement("span");
    chip.className = "flag-chip";
    chip.textContent = `${item.name} · ${item.fraction}%`;
    chips.append(chip);
  }
  $("quality-card").replaceChildren(headline, detail, chips);
  $("quality-card").onclick = () => { $("quality").checked = !$("quality").checked; $("quality").onchange(); };
  if ($("hover-flag-badge")) $("hover-flag-badge").hidden = true;
  $("fits-link").href = frame.fits_url;
  $("source-link").hidden = !frame.source;
  if (frame.source) $("source-link").href = frame.source;
  $("context-button").hidden = !frame.context.length;
  $("provenance").textContent = frame.provenance;
  $("checksum").textContent = `SHA-256 ${frame.sha256}`;
  updateLegend();
  if (state.field === "vesta" && $("vesta-guide") && !$("vesta-guide").hidden) {
    const marked = state.session.frames.map((item,i)=>item.marker?i:-1).filter(i=>i>=0);
    $("vesta-guide-text").textContent = frame.marker
      ? `Frame ${index+1}: the gold box is a suggested Vesta location on ${dateText(frame.timestamp)}. Switch to the other marked frame to see it shift. This is a guide, not a measured detection.`
      : `Frame ${index+1} has no Vesta guide. The ivory cross is only the field center. Use “Show other marked frame” for the two-frame example.`;
    $("vesta-next-guide").disabled = marked.length < 2;
  }
  $("scale-label").textContent = `${state.session.options.fov}′ FOV`;
  for (const button of $("filmstrip").children) {
    const current = Number(button.dataset.index)===index;
    button.setAttribute("aria-current",String(current));
    button.tabIndex = current ? 0 : -1;  // roving tabindex: the strip is one tab stop
  }
  renderComparison();
  draw();
  if (state.point) inspect(state.point, index);
}

// Toolbar target switcher (absent on older pages: every lookup is guarded).
function syncSwitcher() {
  if (!$("switcher-name")) return;
  const field = state.library?.fields?.find(item => item.key === state.field);
  const count = field ? field.frames : state.session?.frames?.length;
  $("switcher-name").textContent = field ? field.name : state.title;
  $("switcher-count").textContent = count == null ? "" : `${count} obs`;
  $("switcher-thumb").hidden = !field?.thumbnail;
  if (field?.thumbnail) $("switcher-thumb").src = field.thumbnail;
  $("switcher-icon").toggleAttribute("hidden", Boolean(field?.thumbnail));  // SVG has no .hidden property
}

function closeTargets() {
  const popover = $("target-popover");
  if (popover?.matches?.(":popover-open")) popover.hidePopover();
}

function resetView() {
  state.zoom = 1; state.panX = 0; state.panY = 0;
  $("zoom").value = 1;
  $("zoom-value").textContent = "1.0×";
  draw();
}

function sessionReady(session, request) {
  const previousTime = state.session?.frames[state.index]?.timestamp, prev = state.session?.options;  // read before the new session replaces them
  state.session = session;
  state.title = request.title;
  state.field = request.field;
  // Vesta is in only a few frames of its patch: a newly opened patch starts on one that shows it
  const shown = session.frames.findIndex(frame => frame.marker);
  const samePatch = prev && prev.ra === session.options.ra && prev.dec === session.options.dec;
  state.index = Math.max(0, shown);
  if (previousTime && session.frames.length && (shown < 0 || samePatch)) {
    // Changing band or width keeps the time, and with Vesta keeps to the frames that show it
    const gap = i => Math.abs(new Date(session.frames[i].timestamp)-new Date(previousTime));
    state.index = session.frames.map((_, i) => i).filter(i => shown < 0 || session.frames[i].marker).reduce((best, i) => gap(i) < gap(best) ? i : best);
  }
  state.reference = session.frames.length-1;
  state.point = null;
  state.images.clear();
  state.maskCache.clear();
  state.hoverCache.clear();
  if ($("hover-flag-badge")) $("hover-flag-badge").hidden = true;
  $("pixel-result").replaceChildren();
  if ($("field-title").textContent !== state.title) {
    // A new target: replay the name's entrance (first load keeps the same name, so nothing moves on page load)
    const title = $("field-title").parentElement;
    title.classList.remove("arrive"); void title.offsetWidth; title.classList.add("arrive");
  }
  $("field-title").textContent = state.title;
  const category = state.library?.fields?.find(item => item.key === state.field)?.category;
  $("field-type").textContent = `${category ? `${category} · ` : ""}${session.options.ra.toFixed(4)}°, ${session.options.dec.toFixed(4)}°`;
  syncSwitcher();
  $("timeline").max = Math.max(0, session.frames.length-1);
  $("filmstrip").replaceChildren();
  $("reference-date").replaceChildren();
  session.frames.forEach((frame, index) => {
    const button = document.createElement("button");
    button.className = "frame-button";
    button.dataset.index = index;
    button.tabIndex = index===state.index ? 0 : -1;
    button.setAttribute("aria-label",`Open observation ${dateText(frame.timestamp)}`);
    const img = document.createElement("img"); img.src = frame.preview; img.alt = ""; img.loading = "lazy";
    const caption = document.createElement("span"); caption.className = "frame-copy";
    for (const text of [dateText(frame.timestamp), `${timeText(frame.timestamp)} UTC · ${frame.release}`]) {
      const line = document.createElement("span"); line.textContent = text; caption.append(line);
    }
    button.append(img,caption); button.onclick = () => { stop(); setFrame(index); };
    $("filmstrip").append(button);
    const option = new Option(`${dateText(frame.timestamp)} ${timeText(frame.timestamp)} · ${frame.release}`,index);
    $("reference-date").append(option);
  });
  $("reference-date").value = state.reference;
  const excluded = session.excluded_frames || [];
  $("excluded-observations").hidden = excluded.length === 0;
  $("excluded-summary").textContent = `${excluded.length} partial frame${excluded.length === 1 ? "" : "s"}`;
  $("excluded-list").replaceChildren();
  for (const frame of excluded) {
    const line = document.createElement("p");
    line.textContent = `${dateText(frame.timestamp)} · D${frame.detector} · ${frame.coverage}% · ${frame.reason}`;
    if (frame.fits_url) {
      const link = document.createElement("a"); link.href = frame.fits_url; link.textContent = "FITS ↓"; link.download = "";
      line.append(link);
    }
    $("excluded-list").append(line);
  }
  $("play").disabled = session.frames.length < 2;
  $("vesta-example").hidden = state.field !== "vesta";
  const vestaMarked = session.frames.map((frame,i)=>frame.marker?i:-1).filter(i=>i>=0);
  $("vesta-guide").hidden = state.field !== "vesta" || vestaMarked.length < 2;
  if (state.field === "vesta") {
    $("target-note").hidden = false;
    $("target-note").textContent = "Vesta asteroid · ivory cross = center · press Track point to compare with JPL Horizons";
  } else if (state.objectContext) {
    const obj = state.objectContext;
    $("target-note").hidden = false;
    $("target-note").textContent = obj.kind === "stars"
      ? `Gaia DR3 · ${Number(obj.distance).toFixed(1)} ${obj.unit}`
      : `DESI DR1 · z=${Number(obj.redshift).toFixed(4)}`;
  } else {
    $("target-note").hidden = true;
    $("target-note").textContent = "";
  }
  $("viewers").classList.toggle("empty-view", !session.frames.length);
  $("view-message").hidden = session.frames.length > 0;
  $("view-message").textContent = session.empty_reason || "";
  $("archive-search").classList.toggle("primary-hint", !session.frames.length && !excluded.length);
  for (const id of ["play","previous","next","timeline","reference-date","export"]) $(id).disabled = !session.frames.length || (id === "play" && session.frames.length < 2);
  if (session.frames.length) {
    resetView();
    setFrame(state.vestaDemo && vestaMarked.length ? vestaMarked[0] : state.index);
    state.vestaDemo = false;
  } else {
    ++state.drawVersion;
    for (const id of ["sky","reference"]) { const canvas=$(id); canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height); }
    $("metadata").replaceChildren(); $("quality-card").replaceChildren();
    $("observation-date").textContent = "No frames"; $("observation-time").textContent = "";
    if ($("frame-counter")) $("frame-counter").textContent = "Frame 0 / 0";
    $("baseline").textContent = "0 frames"; $("comparison-note").textContent = session.empty_reason || "No matches";
    $("frame-caption").textContent = ""; $("reference-caption").textContent = "";
    $("frame-caption").style.removeProperty("--swatch"); $("reference-caption").style.removeProperty("--swatch"); $("scale-label").textContent = "";
    updateLegend();
    $("fits-link").removeAttribute("href"); $("source-link").hidden = true; $("context-button").hidden = true;
    $("provenance").textContent = ""; $("checksum").textContent = "";
  }
  const countText = session.archive_matches == null ? `${session.frames.length} frames` : `${session.frames.length} / ${session.archive_matches} frames`;
  const capText = session.limited ? ` · evenly spaced from ${session.matched_frames}` : "";
  status(`${countText}${capText}${session.failures.length ? ` · ${session.failures.length} errors` : ""}`);
  $("source-state").textContent = `Synced ${new Date(session.created_utc).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
  const url = new URL(location.href);
  for (const key of ["ra","dec","fov","detector","start","end"]) {
    const value = session.options[key];
    if (value !== "") url.searchParams.set(key,value); else url.searchParams.delete(key);
  }
  url.searchParams.set("field",state.field);
  history.replaceState(null,"",url);
  window.dispatchEvent(new CustomEvent("sky-session-ready",{detail:session}));
}

function inputs() {
  return Object.fromEntries(["ra","dec","fov","detector","start","end"].map(key => [key,$(key).value]));
}

function requestIdentity(request) {
  return JSON.stringify(request.options);
}

function loadingMessage(label) {
  const box = $("view-message");
  let text = box.querySelector("span"), bar = box.querySelector(".load-progress");
  if (!text) { box.replaceChildren(); text = document.createElement("span"); box.append(text); bar = null; }
  text.textContent = label;
  const match = /(\d+)\s+of\s+(\d+)/.exec(label);
  if (!match || Number(match[2]) <= 0) { bar?.remove(); return; }
  const total = Number(match[2]), now = Math.min(Number(match[1]), total);
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "load-progress";
    bar.setAttribute("role","progressbar");
    bar.setAttribute("aria-label","Loading progress");
    bar.setAttribute("aria-valuemin","0");
    bar.append(document.createElement("i"));
    box.append(bar);
  }
  bar.setAttribute("aria-valuemax",String(total));
  bar.setAttribute("aria-valuenow",String(now));
  bar.firstChild.style.width = `${(now/total*100).toFixed(1)}%`;
}

async function search(source="saved") {
  const request = {options: inputs(), source, field: state.field, title: state.title, version: ++state.requestVersion};
  state.pending = request;
  stop();
  ++state.drawVersion;
  $("metadata").replaceChildren(); $("quality-card").replaceChildren();  // the old frame's band must not show beside the new choice
  $("viewers").setAttribute("aria-busy","true");
  $("view-message").hidden = false;
  $("view-message").textContent = `Loading ${request.options.fov}′ D${request.options.detector}`;
  status(`Loading D${request.options.detector} · ${request.options.fov}′`,"busy");
  if (state.loading) return; // The loop always takes the latest choice next.
  state.loading = true;
  while (state.pending) {
    const current = state.pending;
    state.pending = null;
    try {
      const key = requestIdentity(current);
      let result = current.source === "saved" ? state.views.get(key) : null;
      let fetched = false;
      if (!result) {
        const job = await api("/api/jobs", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...current.options,source:current.source})});
        while (true) {
          const progress = await api(`/api/jobs/${job.id}`);
          if (progress.status === "failed") throw new Error(progress.stage);
          if (progress.status === "complete") { result = progress.result; break; }
          if (current.version === state.requestVersion) {
            const label = progress.stage || `Loading ${current.options.fov}′ D${current.options.detector}`;
            status(label, "busy");
            loadingMessage(label);
          }
          await new Promise(resolve => setTimeout(resolve,350));
        }
        state.views.set(key,result);
        fetched = true;
      }
      if (current.version === state.requestVersion) {
        state.loading = false;
        $("viewers").setAttribute("aria-busy","false");
        sessionReady(result,current);
        // A view that had to be fetched comes into focus; revisited views switch instantly.
        const stage = $("viewers");
        stage.classList.remove("resolve");
        if (fetched) { void stage.offsetWidth; stage.classList.add("resolve"); }
      }
    } catch(error) {
      if (current.version === state.requestVersion) {
        state.session = null; ++state.drawVersion;
        $("view-message").hidden = false;
        $("view-message").textContent = error.message;
        $("viewers").classList.add("empty-view");
        $("viewers").setAttribute("aria-busy","false");
        $("metadata").replaceChildren();
        for (const id of ["play","previous","next","timeline","reference-date","export"]) $(id).disabled = true;
        status(error.message,"error");
      }
    }
  }
  state.loading = false;
}

function chooseField(field) {
  state.title = field.name;
  state.field = field.key;
  state.objectContext = null;
  $("ra").value = field.ra;
  $("dec").value = field.dec;
  $("light-redshift").value = "0";
  // Preserve the chosen width and detector while switching targets.
  $("start").value = ""; $("end").value = "";
  for (const button of $("fields").children) button.setAttribute("aria-current",String(button.dataset.key === field.key));
  closeTargets();
  syncSwitcher();
  search();
}

function setWorkspaceMode(mode) {
  const showUniverse = mode === "universe";
  if (showUniverse) stop();
  $("observations-mode").setAttribute("aria-pressed", String(!showUniverse));
  $("universe-mode").setAttribute("aria-pressed", String(showUniverse));
  $("observations-workspace").hidden = showUniverse;
  $("universe-workspace").hidden = !showUniverse;
  if (!showUniverse && state.session?.frames?.length) requestAnimationFrame(draw);
  window.dispatchEvent(new CustomEvent("workspace-mode-changed", { detail: { mode } }));
}

for (const name of ["fov","detector"]) {
  $(name).onchange = () => search();
  for (const [direction, step] of [["prev",-1],["next",1]]) {
    $(`${name}-${direction}`).onclick = () => {
      const select = $(name);
      select.selectedIndex = (select.selectedIndex + step + select.options.length) % select.options.length;
      search();
    };
  }
}
for (const name of ["start","end"]) $(name).onchange = () => search();

function selectTab(name) {
  for (const tab of ["observation","pixel"]) {
    $(`tab-${tab}`).setAttribute("aria-selected",String(name===tab));
    $(`tab-${tab}`).tabIndex = name===tab ? 0 : -1;
    $(`${tab}-panel`).hidden = name!==tab;
  }
}

async function inspect(point, frameIndex) {
  const version = ++state.inspectVersion;
  const sessionId = state.session.id;
  $("pixel-result").textContent = "Reading…";
  try {
    const query = new URLSearchParams({session:sessionId,frame:frameIndex,x:point.x,y:point.y});
    const pixel = await api(`/api/pixel?${query}`);
    if (version !== state.inspectVersion || sessionId !== state.session.id) return;
    const list = document.createElement("dl");
    entryList(list, [["Date",dateText(state.session.frames[frameIndex].timestamp)],
      ["Coords",`${pixel.ra.toFixed(5)}°, ${pixel.dec.toFixed(5)}°`],
      ["Brightness",pixel.covered ? `${numberText(pixel.value,4)} ${pixel.unit}` : "No data"],
      ["Error",pixel.covered ? `±${numberText(pixel.uncertainty,4)}` : "—"],
      ["Wavelength",pixel.wavelength == null ? "—" : `${pixel.wavelength.toFixed(4)} µm`],
      ["Pixel XY",pixel.native_pixel ? pixel.native_pixel.join(", ") : "Outside"],
      ["Flag bits",pixel.flags == null ? "—" : String(pixel.flags)]]);
    const flags = document.createElement("div");
    for (const flag of pixel.flag_details || []) {
      const label = document.createElement("span");
      label.className = `flag ${flag.kind || (flag.caution ? "caution" : "info")}`;
      label.textContent = flag.name;
      flags.append(label);
    }
    if (!flags.children.length && pixel.nearby_flags?.length) {
      const near = document.createElement("span");
      near.className = "flag near";
      near.textContent = `Near (±1 px): ${pixel.nearby_flags.map(f => f.name).join(", ")}`;
      flags.append(near);
    }
    $("pixel-result").replaceChildren(list,flags);
    window.dispatchEvent(new CustomEvent("sky-point-picked",{detail:{...point,ra:pixel.ra,dec:pixel.dec,frame:frameIndex}}));
  } catch(error) { if (version === state.inspectVersion) $("pixel-result").textContent = error.message; }
}

async function maskPixels(url) {
  if (!url) return null;
  if (!state.maskCache.has(url)) {
    const img = await imageFor(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    state.maskCache.set(url, { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height });
  }
  return state.maskCache.get(url);
}

let hoverTimer = null, hoverSeq = 0;
async function updateHoverFlag(id, x, y) {
  const badge = $("hover-flag-badge");
  if (!badge) return;
  if (!$("quality").checked || !state.session?.frames?.length || x < 0 || x >= 1 || y < 0 || y >= 1) {
    badge.hidden = true; return;
  }
  const fIdx = id === "sky" ? state.index : state.reference;
  const frame = state.session.frames[fIdx];
  if (!frame?.mask) { badge.hidden = true; return; }
  try {
    const m = await maskPixels(frame.mask);
    if (!m) { badge.hidden = true; return; }
    const cx = Math.floor(x * m.w), cy = Math.floor(y * m.h);
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px >= 0 && px < m.w && py >= 0 && py < m.h && m.data[(py * m.w + px) * 4 + 3] > 20) { hit = true; break; }
      }
    }
    if (!hit) { badge.hidden = true; return; }
    const qKey = `${state.session.id}:${fIdx}:${Math.round(x * 150)}:${Math.round(y * 150)}`;
    if (state.hoverCache.has(qKey)) {
      badge.textContent = state.hoverCache.get(qKey);
      badge.hidden = false;
      return;
    }
    const topName = frame.flag_summary?.[0]?.name || "Artifact mask";
    badge.textContent = `${topName} · checking`;
    badge.hidden = false;
    clearTimeout(hoverTimer);
    const seq = ++hoverSeq;
    hoverTimer = setTimeout(async () => {
      try {
        const res = await api(`/api/pixel?${new URLSearchParams({ session: state.session.id, frame: fIdx, x, y })}`);
        if (seq !== hoverSeq) return;
        const hits = [...(res.flag_details || []).filter(f => f.kind !== "info" || f.caution), ...(res.nearby_flags || [])];
        const msg = hits.length ? hits.slice(0, 2).map(f => f.name).join(" · ") : topName;
        state.hoverCache.set(qKey, msg);
        if (!badge.hidden) badge.textContent = msg;
      } catch {}
    }, 110);
  } catch { badge.hidden = true; }
}

for (const id of ["sky","reference"]) {
  const canvas = $(id);
  let drag = null;
  canvas.addEventListener("pointerdown", event => {
    if (!state.session?.frames.length) return;
    drag = {x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY,moved:false};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag) {
      if (state.session?.frames?.length) {
        const rect = canvas.getBoundingClientRect(), view = transform(canvas);
        const x = (event.clientX - rect.left - view.left) / view.side;
        const y = (event.clientY - rect.top - view.top) / view.side;
        updateHoverFlag(id, x, y);
        if (id === "sky" && typeof StarTracker !== "undefined")
          canvas.style.cursor = StarTracker.pick(event.clientX-rect.left, event.clientY-rect.top, view) ? "pointer" : "";
      }
      return;
    }
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (Math.abs(dx)+Math.abs(dy)>4) drag.moved = true;
    if (drag.moved) {
      const rect = canvas.getBoundingClientRect();
      state.panX = drag.panX+dx/rect.width; state.panY = drag.panY+dy/rect.height;
      draw();
    }
  });
  canvas.addEventListener("pointerleave", () => { if ($("hover-flag-badge")) $("hover-flag-badge").hidden = true; });
  canvas.addEventListener("pointerup", event => {
    if (!drag) return;
    if (!drag.moved) {
      const rect = canvas.getBoundingClientRect();
      const view = transform(canvas);
      const x = (event.clientX-rect.left-view.left)/view.side;
      const y = (event.clientY-rect.top-view.top)/view.side;
      const hit = id === "sky" && typeof StarTracker !== "undefined"
        ? StarTracker.pick(event.clientX-rect.left, event.clientY-rect.top, view) : null;
      if (hit) StarTracker.open(hit);
      else if (x>=0 && x<1 && y>=0 && y<1) pickPixel(id, x, y);
    }
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  // stage.css lets a finger scroll the page over the image (touch-action: pan-y); once zoomed, keep the touch for panning.
  canvas.addEventListener("touchstart", event => { if (state.zoom > 1) event.preventDefault(); }, {passive: false});
  canvas.addEventListener("keydown", event => {
    if (!state.session?.frames.length) return;
    const step = (event.shiftKey ? 10 : 1) / Math.ceil(state.session.options.fov*60/6.15);  // 1 native 6.15″ pixel, as science.py grids it
    const move = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    const from = state.cursor?.id === id ? state.cursor : (state.point || {x:.5,y:.5});
    if (move) {
      const clamp = v => Math.min(1-1e-6, Math.max(0, v));
      state.cursor = {id, x:clamp(from.x+move[0]*step), y:clamp(from.y+move[1]*step)};
    } else if (event.key === "Enter" || event.key === " ") {
      if (state.cursor?.id !== id) state.cursor = {id, x:from.x, y:from.y};  // first press shows the crosshair
      else { pickPixel(id, from.x, from.y); status("Pixel selected"); }
    } else if (event.key === "Escape" && state.cursor) state.cursor = null;
    else return;
    event.preventDefault(); draw();
  });
  canvas.addEventListener("blur", () => { if (state.cursor?.id === id) { state.cursor = null; draw(); } });
}

function pickPixel(id, x, y) {
  stop(); state.point = {x,y}; selectTab("pixel");
  inspect(state.point,id === "sky" ? state.index : state.reference); draw(); updateLegend();
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function contextView() {
  if (!state.session?.frames.length) return;
  const frame = state.session.frames[state.index];
  const views = frame.context;
  function choose(view) {
    $("context-image").src = view.jpeg;
    $("context-source").href = view.source;
    $("context-note").textContent = `D${view.detector} · ${view.range} µm · ${view.containsFieldCenter ? "Target inside" : "Offset sky"}`;
    for (const button of $("context-bands").children) button.setAttribute("aria-pressed",String(Number(button.dataset.detector)===view.detector));
  }
  $("context-bands").replaceChildren();
  for (const view of views) {
    const button = document.createElement("button"); button.textContent = `D${view.detector}`; button.dataset.detector = view.detector;
    button.onclick = () => choose(view); $("context-bands").append(button);
  }
  choose(views.find(view => view.detector === frame.detector) || views[0]);
  $("context").showModal();
}

function categoryBadge(category="") {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("width", "12");
  icon.setAttribute("height", "12");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.6");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("class", "field-cat-icon");
  const p = document.createElementNS(ns, "path");
  const lower = String(category).toLowerCase();
  if (lower.includes("asteroid")) p.setAttribute("d", "M2.5 11.5c2.5-5 8-7.5 11-7M11 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z");
  else if (lower.includes("brown") || lower.includes("dwarf")) p.setAttribute("d", "M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2.5 9.5c3.5 1.6 7.5 1.6 11 0");
  else p.setAttribute("d", "M8 2v3M8 11v3M2 8h3M11 8h3M4.5 4.5l2 2M9.5 9.5l2 2M11.5 4.5l-2 2M6.5 9.5l-2 2");
  icon.append(p);
  return icon;
}

async function library() {
  const data = await api("/api/library");
  if (state.library?.sync?.completed !== data.sync?.completed) state.views.clear();
  state.library = data;
  $("inventory").textContent = `${data.fields.reduce((n,f)=>n+f.frames,0).toLocaleString("en")} obs`;
  $("collections").textContent = data.config.collections.join(" · ");
  $("fields").replaceChildren();
  for (const field of data.fields) {
    const button = document.createElement("button"); button.className = "field"; button.dataset.key = field.key;
    button.setAttribute("aria-current",String(field.key===state.field));
    button.title = `${field.category} · ${field.frames} obs`;
    const img = document.createElement("img"); img.src = field.thumbnail; img.alt = "";
    const copy = document.createElement("span"); copy.className = "field-copy";
    const meta = document.createElement("span"), title = document.createElement("strong"), description = document.createElement("small");
    title.textContent = field.name; description.textContent = `${field.frames} obs`;
    meta.append(title,description); copy.append(categoryBadge(field.category),meta); button.append(img,copy); button.onclick = () => chooseField(field);
    $("fields").append(button);
  }
  syncSwitcher();
  const sync = data.sync;
  $("sync-status").textContent = sync ? `${sync.status} · ${sync.completed}/${sync.total} synced` : "Local cache";
  $("imported-list").replaceChildren();
  for (const item of data.imports) {
    const row = document.createElement("div"); row.className = "imported-row";
    const title = document.createElement("span"); title.textContent = `${item.id} · D${item.detector} · ${item.release}`;
    const open = document.createElement("button"); open.className = "btn-outline btn-compact"; open.textContent = "Open";
    open.onclick = () => {
      $("updates").close();
      $("detector").value = item.detector;
      chooseField({...item,name:"Imported field",key:"imported"});
    };
    row.append(title,open); $("imported-list").append(row);
  }
  return data;
}

$("observations-mode").onclick = () => setWorkspaceMode("observations");
$("universe-mode").onclick = () => setWorkspaceMode("universe");
window.addEventListener?.("universe-open-object", event => {
  const detail = event.detail;
  if (!detail) return;
  setWorkspaceMode("observations");
  state.title = detail.name || "Catalog object";
  state.field = "custom";
  state.objectContext = detail;
  $("ra").value = Number(detail.ra).toFixed(7);
  $("dec").value = Number(detail.dec).toFixed(7);
  $("start").value = "";
  $("end").value = "";
  $("light-redshift").value = detail.kind === "galaxies" && Number.isFinite(detail.redshift)
    ? String(Number(detail.redshift.toFixed(5)))
    : "0";
  for (const button of $("fields").children) button.setAttribute("aria-current", "false");
  search("saved");
  $("search-form").scrollIntoView({ behavior: "smooth", block: "start" });
});

// Editing RA/Dec already turns the view into a custom patch (input listener below); an unedited saved target keeps its name and box
$("search-form").onsubmit = event => { event.preventDefault(); search(); };
$("archive-search").onclick = () => {
  if (!state.objectContext) {
    state.title = "IRSA patch";
    state.field = "custom";
  }
  search("archive");
};
$("vesta-example").onclick = () => {
  const field = state.library?.fields?.find(item => item.key === "vesta");
  if (!field) { status("The saved Vesta field is unavailable.","error"); return; }
  state.title = field.name; state.field = field.key; state.objectContext = null;
  $("ra").value = field.ra; $("dec").value = field.dec;
  for (const button of $("fields").children) button.setAttribute("aria-current",String(button.dataset.key === field.key));
  $("start").value = "2025-08-04"; $("end").value = "2025-08-05";
  $("detector").value = "3"; $("fov").value = "15";
  state.vestaDemo = true;
  search();
};
$("vesta-next-guide").onclick = () => {
  const marked = state.session?.frames.map((frame,i)=>frame.marker?i:-1).filter(i=>i>=0) || [];
  if (marked.length < 2) return;
  stop();
  const current = marked.indexOf(state.index);
  setFrame(marked[(current+1)%marked.length]);
};
for (const id of ["ra","dec"]) $(id).addEventListener("input", () => {
  state.title = "Sky patch"; state.field = "custom"; state.objectContext = null;
  for (const button of $("fields").children) button.setAttribute("aria-current","false");
});
$("play").onclick = play;
$("previous").onclick = () => { stop(); if (state.session?.frames.length) setFrame((state.index+state.session.frames.length-1)%state.session.frames.length); };
$("next").onclick = () => { stop(); if (state.session?.frames.length) setFrame((state.index+1)%state.session.frames.length); };
$("timeline").oninput = () => { stop(); setFrame(Number($("timeline").value)); };
$("speed").onchange = () => { if (state.timer) { stop(); play(); } };
$("reference-date").onchange = () => { state.reference = Number($("reference-date").value); renderComparison(); draw(); };
for (const mode of ["single","split"]) $("mode-"+mode).onclick = () => {
  state.mode = mode; $("viewers").classList.toggle("split",mode==="split"); $("reference-pane").hidden = mode!=="split";
  for (const name of ["single","split"]) $("mode-"+name).setAttribute("aria-pressed",String(mode===name));
  if (state.session) { renderComparison(); draw(); }
};
for (const id of ["markers","quality","tint"]) $(id).onchange = () => {
  if ($("flag-legend")) $("flag-legend").hidden = !$("quality").checked;
  if (id === "markers") updateLegend();
  if ($("hover-flag-badge") && !$("quality").checked) $("hover-flag-badge").hidden = true;
  if (id === "quality") {
    const label = $("quality-card")?.querySelector?.("span");
    if (label) label.textContent = $("quality").checked ? "Overlay on · click to hide" : "Click to preview mask";
  }
  draw();
};
$("zoom").oninput = () => { state.zoom = Number($("zoom").value); $("zoom-value").textContent = state.zoom.toFixed(1)+"×"; draw(); };
$("reset-view").onclick = resetView;
for (const tab of ["observation","pixel"]) $("tab-"+tab).onclick = () => selectTab(tab);
$("tab-observation").parentElement.addEventListener("keydown", event => {
  const tabs = ["observation","pixel"], current = tabs.indexOf(event.target.id.replace("tab-",""));
  const next = {ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:tabs.length-1}[event.key];
  if (current < 0 || next === undefined) return;
  event.preventDefault();
  const name = tabs[(next+tabs.length)%tabs.length];
  selectTab(name); $("tab-"+name).focus();
});
// Filmstrip arrows move focus only; Enter/Space open the frame through the button's own click.
$("filmstrip").addEventListener("keydown", event => {
  const buttons = [...$("filmstrip").children], current = buttons.indexOf(event.target);
  const next = {ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:buttons.length-1}[event.key];
  if (current < 0 || next === undefined) return;
  event.preventDefault();  // also keeps the global playback arrows from firing
  const target = buttons[Math.max(0, Math.min(buttons.length-1, next))];
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus();
});
// The popover lives in the top layer; pin it under its button each time it opens.
$("target-popover")?.addEventListener("beforetoggle", event => {
  if (event.newState !== "open") return;
  const rect = $("target-switcher").getBoundingClientRect();
  Object.assign(event.target.style, {top: `${rect.bottom + 6}px`, left: `${rect.left}px`});
});
for (const id of ["updates-button","import-shortcut"]) $(id).onclick = async () => { closeTargets(); $("updates").showModal(); try { await library(); } catch(error) { status(error.message,"error"); } };
for (const button of document.querySelectorAll(".close-dialog")) button.onclick = () => button.closest("dialog").close();
$("context-button").onclick = contextView;
$("share").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); status("Link copied"); }
  catch { status("Copy URL"); }
};
$("export").onclick = () => {
  if (state.session?.frames.length) download(`spherex-session-${state.session.id}.json`,JSON.stringify({...state.session,
    view:{current_frame:state.index,reference_frame:state.reference,mode:state.mode,selected_sky_pixel:state.point}},null,2),"application/json");
};
$("fits-files").onchange = async event => {
  const files = [...event.target.files];
  let imported = 0;
  $("fits-files").disabled = true;
  try {
    for (const file of files) {
      $("import-status").textContent = `Checking ${file.name}…`;
      await api("/api/import",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Release":$("release-label").value},body:file});
      imported++;
    }
    $("import-status").textContent = `${imported} FITS imported`;
  } catch(error) { $("import-status").textContent = `${imported} imported · ${error.message}`; }
  finally { $("fits-files").disabled = false; $("fits-files").value = ""; await library(); }
};
document.addEventListener("keydown", event => {
  if ($("observations-workspace").hidden || event.defaultPrevented) return;  // the sky canvas and tabs handle their own keys
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
  if (event.code === "Space" && document.activeElement.tagName !== "BUTTON") { event.preventDefault(); play(); }
  if (event.key === "ArrowRight") { event.preventDefault(); $("next").click(); }
  if (event.key === "ArrowLeft") { event.preventDefault(); $("previous").click(); }
});
new ResizeObserver(draw).observe($("viewers"));

(async () => {
  if (location.protocol === "file:") {
    status("Start the local Python server with start.ps1, then open http://127.0.0.1:8765.","error");
    return;
  }
  try {
    const data = await library();
    const params = new URL(location.href).searchParams;
    if (params.has("ra") && params.has("dec")) {
      for (const key of ["ra","dec","fov","detector","start","end"]) if (params.has(key)) $(key).value = params.get(key);
      state.field = params.get("field") || "custom";
      state.title = data.fields.find(field => field.key === state.field)?.name || "Selected sky patch";
      await search();
    } else chooseField(data.fields[0]);
  } catch(error) { status(`Unable to load the local service. ${error.message}`,"error"); }
})();
