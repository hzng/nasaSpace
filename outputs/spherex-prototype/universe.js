"use strict";
const UniverseMap = (() => {
  const catalogs = new Map();
  let kind = "galaxies";
  let catalog = null;
  let selected = null;
  let loadToken = 0;
  let rafId = 0;
  let hoveredIndex = -1;
  let eligible = new Set();
  let results = [];
  let page = 0;
  let extent = 1;
  let sliceCenter = 0;
  let neighborhoodCenter = null;
  const pageSize = 8;

  function selectRecord(record) {
    selected = record;
    cam.target = [...positionOf(record)];
    updateSelectionPanel();
    renderResults();
    scheduleDraw();
  }

  function renderResults() {
    const parent = $("atlas-results");
    parent.replaceChildren();
    for (const r of results.slice(page * pageSize, (page + 1) * pageSize)) {
      const button = document.createElement("button");
      button.className = "atlas-object";
      button.setAttribute("aria-pressed", String(selected?.id === r.id));
      const name = document.createElement("strong"), sub = document.createElement("small");
      name.textContent = r.name;
      sub.textContent = `${fmt(r.distance, 1)} ${catalog.unit} · ${kind === "galaxies" ? "z " + fmt(r.redshift, 4) : "star"}`;
      button.append(name, sub);
      button.onclick = () => selectRecord(r);
      parent.append(button);
    }
    if (!results.length) parent.textContent = "No matches. Widen the distance or slice, or clear your search.";
    $("atlas-results-count").textContent = `${results.length.toLocaleString()} matches · ${page + 1}/${Math.max(1, Math.ceil(results.length / pageSize))}`;
    $("atlas-prev-page").disabled = page === 0;
    $("atlas-next-page").disabled = (page + 1) * pageSize >= results.length;
  }

  function applyFilters(fit = false) {
    if (!catalog) return;
    const mode = $("atlas-view").value;
    const limit = extent * Number($("atlas-distance").value) / 100;
    const thickness = extent * 2 * Number($("atlas-thickness").value) / 100;
    const query = $("atlas-search").value.trim().toLowerCase();
    $("atlas-thickness").disabled = mode !== "slice";
    $("atlas-distance-value").textContent = `${fmt(limit, 0)} ${catalog.unit}`;
    $("atlas-thickness-value").textContent = `${fmt(thickness, 0)} ${catalog.unit}`;
    eligible = new Set();
    results = [];
    catalog.records.forEach((r, i) => {
      const pos = positionOf(r);
      const distance = mode === "nearby" && neighborhoodCenter
        ? Math.hypot(...pos.map((x,j) => x-neighborhoodCenter[j])) : r.distance;
      if (distance > limit || (mode === "slice" && Math.abs(pos[2]-sliceCenter) > thickness/2)) return;
      if (query && !`${r.name} ${r.id}`.toLowerCase().includes(query)) return;
      eligible.add(i); results.push(r);
    });
    results.sort($("atlas-sort").value === "name" ? (a,b) => a.name.localeCompare(b.name) : (a,b) => a.distance-b.distance);
    if (selected && !results.includes(selected)) { selected = null; updateSelectionPanel(); }
    page = 0; hoveredIndex = -1;
    renderResults();
    $("atlas-count").textContent = `${results.length.toLocaleString()} / ${catalog.records.length.toLocaleString()} ${kind}`;
    $("atlas-legend").textContent = kind === "galaxies" ? "Blue → gold: increasing redshift · symbolic glow" : "Color: Gaia BP−RP · symbolic glow";
    $("atlas-context").textContent = mode === "slice"
      ? `ICRS Z slice centered at ${fmt(sliceCenter, 0)} ${catalog.unit}, thickness ${fmt(thickness, 0)} ${catalog.unit}. Positions retain their physical scale. Survey gaps are not proof of empty space.`
      : mode === "nearby" ? `Within ${fmt(limit, 0)} ${catalog.unit} of the chosen neighborhood center. Each point is a real catalog object.`
      : "Full sampled volume. These catalogs contain stars and galaxies, not planets. Point glows represent catalog entries, not measured object sizes.";
    if (fit) fitVisible();
    scheduleDraw();
  }

  function fitVisible() {
    if (!results.length) return;
    const lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
    results.forEach(r => positionOf(r).forEach((v,j) => {lo[j]=Math.min(lo[j],v);hi[j]=Math.max(hi[j],v);}));
    cam.target = lo.map((v,j) => (v+hi[j])/2);
    const radius = Math.max(...results.map(r => Math.hypot(...positionOf(r).map((v,j)=>v-cam.target[j]))));
    cam.distance = Math.max(defaultsFor(kind).minDist, radius / Math.sin(cam.fovDeg*Math.PI/360) * 1.12);
    scheduleDraw();
  }


  const cam = {
    yaw: 0.65,
    pitch: 0.42,
    distance: 5200,
    target: [0, 0, 0],
    fovDeg: 48,
  };

  let projX = new Float32Array(0);
  let projY = new Float32Array(0);
  let projZ = new Float32Array(0);
  let order = new Int32Array(0);

  const fmt = (value, digits = 3) =>
    value == null || !Number.isFinite(value)
      ? "Unavailable"
      : Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)
      ? Number(value).toExponential(3)
      : Number(value).toLocaleString("en", { maximumFractionDigits: digits });

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function defaultsFor(currentKind) {
    if (currentKind === "stars") {
      return {
        distance: 520,
        minDist: 0.01,
        maxDist: 2200,
        rings: [50, 100, 150, 200],
        axisLen: 220,
      };
    }
    return {
      distance: 5200,
      minDist: 0.5,
      maxDist: 18000,
      rings: [500, 1000, 2000, 3000],
      axisLen: 3400,
    };
  }

  function resetCamera() {
    const cfg = defaultsFor(kind);
    cam.yaw = 0.65;
    cam.pitch = 1.15;
    cam.distance = cfg.distance;
    cam.target = [0, 0, 0];
    if (catalog) fitVisible();
    scheduleDraw();
  }

  function currentYear() {
    return Number($("universe-year").value || (catalog?.epoch ?? 2016));
  }

  function positionOf(record) {
    if (kind === "stars" && Array.isArray(record.velocity)) {
      const epoch = record.epoch ?? catalog?.epoch ?? 2016;
      const dt = currentYear() - epoch;
      return [
        record.xyz[0] + record.velocity[0] * dt,
        record.xyz[1] + record.velocity[1] * dt,
        record.xyz[2] + record.velocity[2] * dt,
      ];
    }
    return record.xyz;
  }

  function galaxyColor(z) {
    const t = clamp((z - 0.01) / 0.9, 0, 1);
    if (t < 0.35) {
      const k = t / 0.35;
      return `rgb(${Math.round(113 + 52 * k)}, ${Math.round(217 + 20 * k)}, ${Math.round(246 - 42 * k)})`;
    }
    if (t < 0.7) {
      const k = (t - 0.35) / 0.35;
      return `rgb(${Math.round(165 + 75 * k)}, ${Math.round(237 - 14 * k)}, ${Math.round(204 - 74 * k)})`;
    }
    const k = (t - 0.7) / 0.3;
    return `rgb(${Math.round(240 + 4 * k)}, ${Math.round(223 - 57 * k)}, ${Math.round(130 + 30 * k)})`;
  }

  function starColor(bpRp) {
    if (bpRp == null || !Number.isFinite(bpRp)) return "#98a9b3";
    if (bpRp < 0.3) return "#9dc9ff";
    if (bpRp < 0.9) return "#ebf2f7";
    if (bpRp < 1.6) return "#f5cf86";
    return "#ef9b8a";
  }

  function basis() {
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const camPos = [
      cam.target[0] + cam.distance * cp * cy,
      cam.target[1] + cam.distance * cp * sy,
      cam.target[2] + cam.distance * sp,
    ];
    const forward = [-cp * cy, -cp * sy, -sp];
    const right = [-sy, cy, 0];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    return { camPos, forward, right, up };
  }

  function projectPoint(point, view, width, height, focal) {
    const rx = point[0] - view.camPos[0];
    const ry = point[1] - view.camPos[1];
    const rz = point[2] - view.camPos[2];
    const cz = rx * view.forward[0] + ry * view.forward[1] + rz * view.forward[2];
    if (cz <= Math.max(1e-4, cam.distance * 0.005)) return null;
    const cx = rx * view.right[0] + ry * view.right[1] + rz * view.right[2];
    const cy = rx * view.up[0] + ry * view.up[1] + rz * view.up[2];
    return [width / 2 + (cx / cz) * focal, height / 2 - (cy / cz) * focal, cz];
  }

  function scheduleDraw() {
    if (rafId || $("universe-workspace").hidden) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  function draw() {
    if ($("universe-workspace").hidden) return;
    const canvas = $("universe-canvas");
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * ratio);
    const targetH = Math.round(rect.height * ratio);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const cfg = defaultsFor(kind);
    const view = basis();
    const focal = (0.5 * Math.min(rect.width, rect.height)) / Math.tan((cam.fovDeg * Math.PI) / 360);

    // Pure display backdrop; no synthetic objects are added.
    const wash = ctx.createRadialGradient(rect.width*.5,rect.height*.45,0,rect.width*.5,rect.height*.45,rect.width*.7);
    wash.addColorStop(0,"#111d2a"); wash.addColorStop(.6,"#0a101b"); wash.addColorStop(1,"#05070c");
    ctx.fillStyle=wash; ctx.fillRect(0,0,rect.width,rect.height);
    ctx.font = "11.5px 'Cascadia Code', Consolas, monospace";
    // Draw equatorial ICRS reference rings and cardinal axes only on request.
    if ($("atlas-grid").checked) {
    ctx.lineWidth = 1;
    ctx.font = "11.5px 'Cascadia Code', Consolas, monospace";
    for (const radius of cfg.rings) {
      ctx.strokeStyle = "rgba(243, 239, 230, 0.14)";
      ctx.beginPath();
      let penDown = false;
      for (let i = 0; i <= 96; i++) {
        const theta = (i / 96) * 2 * Math.PI;
        const pt = projectPoint([radius * Math.cos(theta), radius * Math.sin(theta), 0], view, rect.width, rect.height, focal);
        if (!pt) {
          penDown = false;
          continue;
        }
        if (!penDown) {
          ctx.moveTo(pt[0], pt[1]);
          penDown = true;
        } else {
          ctx.lineTo(pt[0], pt[1]);
        }
      }
      ctx.stroke();
      const labelPt = projectPoint([radius, 0, 0], view, rect.width, rect.height, focal);
      if (labelPt && labelPt[0] > 20 && labelPt[0] < rect.width - 50 && labelPt[1] > 14 && labelPt[1] < rect.height - 14) {
        ctx.fillStyle = "rgba(182, 177, 168, 0.72)";
        ctx.fillText(`${radius} ${catalog?.unit || (kind === "stars" ? "pc" : "Mpc")}`, labelPt[0] + 4, labelPt[1] - 4);
      }
    }

    const originPt = projectPoint([0, 0, 0], view, rect.width, rect.height, focal);
    const axes = [
      { vec: [cfg.axisLen, 0, 0], label: "RA 0h (+X)" },
      { vec: [0, cfg.axisLen, 0], label: "RA 6h (+Y)" },
      { vec: [0, 0, cfg.axisLen], label: "NCP (+Z)" },
    ];
    ctx.strokeStyle = "rgba(234, 179, 84, 0.28)";
    for (const axis of axes) {
      const endPt = projectPoint(axis.vec, view, rect.width, rect.height, focal);
      if (originPt && endPt) {
        ctx.beginPath();
        ctx.moveTo(originPt[0], originPt[1]);
        ctx.lineTo(endPt[0], endPt[1]);
        ctx.stroke();
        ctx.fillStyle = "rgba(234, 179, 84, 0.78)";
        ctx.fillText(axis.label, endPt[0] + 5, endPt[1] + 3);
      }
    }

    if (originPt) {
      ctx.fillStyle = "#eab354";
      ctx.beginPath();
      ctx.arc(originPt[0], originPt[1], 4.2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#0c0d10";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#eab354";
      ctx.fillText("Solar System (0)", originPt[0] + 7, originPt[1] + 3);
    }

    } // coordinate guides

    if (!catalog?.records?.length) return;
    const records = catalog.records;
    const n = records.length;
    if (projX.length !== n) {
      projX = new Float32Array(n);
      projY = new Float32Array(n);
      projZ = new Float32Array(n);
      order = new Int32Array(n);
    }

    let visibleCount = 0;
    const nearClip = Math.max(1e-4, cam.distance * 0.005);
    const epoch = catalog.epoch ?? 2016;
    const dt = kind === "stars" ? currentYear() - epoch : 0;

    for (let i = 0; i < n; i++) {
      const r = records[i];
      if (!eligible.has(i)) { projZ[i] = -1; continue; }
      let wx = r.xyz[0];
      let wy = r.xyz[1];
      let wz = r.xyz[2];
      const recordDt = kind === "stars" ? currentYear() - (r.epoch ?? epoch) : 0;
      if (recordDt !== 0 && Array.isArray(r.velocity)) {
        wx += r.velocity[0] * recordDt;
        wy += r.velocity[1] * recordDt;
        wz += r.velocity[2] * recordDt;
      }
      const rx = wx - view.camPos[0];
      const ry = wy - view.camPos[1];
      const rz = wz - view.camPos[2];
      const cz = rx * view.forward[0] + ry * view.forward[1] + rz * view.forward[2];
      if (cz <= nearClip) {
        projZ[i] = -1;
        continue;
      }
      const cx = rx * view.right[0] + ry * view.right[1] + rz * view.right[2];
      const cy = rx * view.up[0] + ry * view.up[1] + rz * view.up[2];
      const sx = rect.width / 2 + (cx / cz) * focal;
      const sy = rect.height / 2 - (cy / cz) * focal;
      if (sx < -20 || sx > rect.width + 20 || sy < -20 || sy > rect.height + 20) {
        projZ[i] = -1;
        continue;
      }
      projX[i] = sx;
      projY[i] = sy;
      projZ[i] = cz;
      order[visibleCount++] = i;
    }

    const active = order.subarray(0, visibleCount);
    active.sort((a, b) => projZ[b] - projZ[a]);

    for (let k = 0; k < visibleCount; k++) {
      const i = active[k];
      const r = records[i];
      const sx = projX[i];
      const sy = projY[i];
      const color = kind === "galaxies" ? galaxyColor(r.redshift) : starColor(r.color);
      const chosen = selected?.id === r.id;
      const radius = chosen ? 3 : clamp(1.6 * Math.sqrt(cam.distance / projZ[i]), .8, 2.6);
      const halo = ctx.createRadialGradient(sx,sy,0,sx,sy,radius*4);
      halo.addColorStop(0,color); halo.addColorStop(1,"transparent");
      ctx.globalAlpha = chosen ? .75 : selected ? .12 : .25;
      ctx.fillStyle=halo;ctx.fillRect(sx-radius*4,sy-radius*4,radius*8,radius*8);
      ctx.globalAlpha=chosen ? 1 : selected ? .36 : .85;
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(sx,sy,radius,0,Math.PI*2);ctx.fill();

    }
    ctx.globalAlpha = 1;

    if (hoveredIndex >= 0 && projZ[hoveredIndex] > 0) {
      const hr = records[hoveredIndex];
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(projX[hoveredIndex], projY[hoveredIndex], 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#e7efef";
      ctx.fillText(hr.name, Math.min(rect.width - 140, projX[hoveredIndex] + 9), Math.max(16, projY[hoveredIndex] - 6));
    }

    if (selected) {
      const pos = positionOf(selected);
      const selPt = projectPoint(pos, view, rect.width, rect.height, focal);

      // Draw true straight-line 3D velocity displacement from J2016.0 catalog position if measured.
      if (kind === "stars" && Array.isArray(selected.velocity) && dt !== 0) {
        const catPt = projectPoint(selected.xyz, view, rect.width, rect.height, focal);
        if (catPt && selPt) {
          ctx.strokeStyle = "#80e6ff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(catPt[0], catPt[1]);
          ctx.lineTo(selPt[0], selPt[1]);
          ctx.stroke();
          ctx.fillStyle = "rgba(128, 230, 255, 0.75)";
          ctx.beginPath();
          ctx.arc(catPt[0], catPt[1], 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Draw exact formal radial distance uncertainty along the sightline from the origin.
      if ($("universe-errors").checked && Number.isFinite(selected.distance_error) && selected.distance > 0) {
        const norm = Math.hypot(selected.xyz[0], selected.xyz[1], selected.xyz[2]) || 1;
        const ux = selected.xyz[0] / norm;
        const uy = selected.xyz[1] / norm;
        const uz = selected.xyz[2] / norm;
        const err = selected.distance_error;
        const pLow = projectPoint([pos[0] - ux * err, pos[1] - uy * err, pos[2] - uz * err], view, rect.width, rect.height, focal);
        const pHigh = projectPoint([pos[0] + ux * err, pos[1] + uy * err, pos[2] + uz * err], view, rect.width, rect.height, focal);
        if (pLow && pHigh) {
          ctx.strokeStyle = "#eab354";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pLow[0], pLow[1]);
          ctx.lineTo(pHigh[0], pHigh[1]);
          ctx.stroke();
          const spanPx = Math.hypot(pHigh[0] - pLow[0], pHigh[1] - pLow[1]);
          if (spanPx >= 4) {
            const nx = -(pHigh[1] - pLow[1]) / spanPx;
            const ny = (pHigh[0] - pLow[0]) / spanPx;
            for (const end of [pLow, pHigh]) {
              ctx.beginPath();
              ctx.moveTo(end[0] - nx * 4, end[1] - ny * 4);
              ctx.lineTo(end[0] + nx * 4, end[1] + ny * 4);
              ctx.stroke();
            }
          }
        }
      }

      if (selPt) {
        ctx.strokeStyle = "#6cb8ff";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(selPt[0], selPt[1], 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = "#6cb8ff";
        ctx.fillText(selected.name, Math.min(rect.width - 150, selPt[0] + 11), Math.max(16, selPt[1] + 4));
      }
    }

    const unit = catalog.unit || (kind === "stars" ? "pc" : "Mpc");
    const spanApprox = 2 * cam.distance * Math.tan((cam.fovDeg * Math.PI) / 360);
    $("universe-scale").textContent = `Camera → focus: ${fmt(cam.distance, 1)} ${unit} · span at focus ≈ ${fmt(spanApprox, 0)} ${unit}`;
  }

  function updateSelectionPanel() {
    $("focus-object").disabled = !selected;
    $("open-object").disabled = !selected;
    $("universe-export").disabled = !selected;
    if (!selected) {
      $("universe-object").textContent = "Solar System origin";
      if (!catalog) {
        $("universe-metadata").replaceChildren();
        return;
      }
      const entries = [
        ["Source", catalog.source],
        ["Sample", `${catalog.records.length.toLocaleString("en")} real ${kind}`],
        ["Distance", `${catalog.distance_kind} (${catalog.unit})`],
      ];
      if (kind === "galaxies" && catalog.cosmology) {
        entries.push(["Cosmology", catalog.cosmology.name]);
      } else {
        const rvCount = catalog.records.filter(r => Array.isArray(r.velocity)).length;
        entries.push(["Epoch", `J${catalog.epoch}`]);
        entries.push(["3D vel", `${rvCount.toLocaleString("en")} / ${catalog.records.length.toLocaleString("en")}`]);
      }
      entries.push(["SHA-256", `${catalog.raw_sha256.slice(0, 12)}…`]);
      entryList($("universe-metadata"), entries);
      $("universe-selection-note").textContent = "Real catalog coordinates";
      return;
    }

    $("universe-object").textContent = selected.name;
    if (kind === "galaxies") {
      entryList($("universe-metadata"), [
        ["Target ID", selected.id],
        ["Coords", `${selected.ra.toFixed(5)}°, ${selected.dec.toFixed(5)}°`],
        ["Redshift z", `${selected.redshift.toFixed(5)} ± ${selected.redshift_error == null ? "—" : selected.redshift_error.toExponential(1)}`],
        ["Distance", `${fmt(selected.distance, 1)} ± ${fmt(selected.distance_error, 2)} ${catalog.unit}`],
        ["Lookback", `${fmt(selected.lookback_gyr, 2)} Gyr`],
        ["XYZ (Mpc)", selected.xyz.map(v => fmt(v, 1)).join(", ")],
        ["Δχ²", fmt(selected.quality_delta_chi2, 1)],
        ["MJD", selected.observed_mjd == null ? "—" : fmt(selected.observed_mjd, 1)],
        ["Peculiar vel", "Not modeled"],
      ]);
      $("universe-selection-note").textContent = "Planck18 redshift distance";
    } else {
      const year = currentYear();
      const has3D = Array.isArray(selected.velocity);
      const pos = positionOf(selected);
      const distAtYear = Math.hypot(pos[0], pos[1], pos[2]);
      entryList($("universe-metadata"), [
        ["Source ID", selected.id],
        [`ICRS J${selected.epoch}`, `${selected.ra.toFixed(5)}°, ${selected.dec.toFixed(5)}°`],
        [`Epoch ${selected.spherex_position_epoch ?? 2026.8}`, `${(selected.spherex_ra ?? selected.ra).toFixed(5)}°, ${(selected.spherex_dec ?? selected.dec).toFixed(5)}°`],
        ["Distance", `${fmt(selected.distance, 2)} ± ${fmt(selected.distance_error, 2)} ${catalog.unit}`],
        ["Parallax", `${selected.parallax.toFixed(2)} ± ${selected.parallax_error.toFixed(2)} mas`],
        ["PM (mas/yr)", `${selected.pmra.toFixed(1)}, ${selected.pmdec.toFixed(1)}`],
        ["Radial vel", selected.radial_velocity == null ? "Not in Gaia" : `${selected.radial_velocity.toFixed(1)} km/s`],
        [`XYZ (${year})`, has3D ? pos.map(v => fmt(v, 2)).join(", ") : `${selected.xyz.map(v => fmt(v, 2)).join(", ")} (fixed)`],
        ["3D velocity", has3D ? selected.velocity.map(v => v.toExponential(1)).join(", ") : "Unavailable (sky-only motion)"],
        ["Proj dist", `${fmt(has3D ? distAtYear : selected.distance, 2)} pc`],
        ["Photometry", `G=${fmt(selected.magnitude, 2)} · BP−RP=${fmt(selected.color, 2)}`],
      ]);
      $("universe-selection-note").textContent = has3D ? "3D linear motion" : "Fixed J2016 position";
    }
  }

  function renderNotes() {
    const parent = $("universe-notes");
    if (!catalog) {
      parent.replaceChildren();
      return;
    }
    const header = document.createElement("p");
    header.style.margin = "0";
    const strong = document.createElement("strong");
    strong.textContent = `${catalog.source} · ${catalog.distance_kind} (${catalog.unit})`;
    const link = document.createElement("a");
    link.href = catalog.source_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = " Catalog documentation ↗";
    link.style.marginLeft = "8px";
    header.append(strong, link);

    const list = document.createElement("ul");
    for (const note of catalog.notes || []) {
      const li = document.createElement("li");
      li.textContent = note;
      list.append(li);
    }
    parent.replaceChildren(header, list);
  }

  async function loadCatalog(nextKind) {
    kind = nextKind;
    catalog = null; eligible.clear(); results = [];
    projZ.fill(-1);
    selected = null;
    hoveredIndex = -1;
    $("universe-time-label").hidden = kind !== "stars";
    const token = ++loadToken;
    if (!catalogs.has(kind)) {
      $("universe-status").textContent = `Loading ${kind}…`;
      try {
        const response = await fetch(`catalogs/${kind}.json`);
        if (!response.ok) throw new Error(`Could not load catalogs/${kind}.json`);
        catalogs.set(kind, await response.json());
      } catch (error) {
        if (token === loadToken) $("universe-status").textContent = error.message;
        return;
      }
    }
    if (token !== loadToken) return;
    catalog = catalogs.get(kind);
    if (kind === "stars") {
      const epoch = Math.round(catalog.epoch || 2016);
      $("universe-year").value = String(epoch);
      $("universe-year-value").textContent = String(epoch);
    }
    extent = Math.max(...catalog.records.map(r=>r.distance));
    const sortedZ = catalog.records.map(r=>r.xyz[2]).sort((a,b)=>a-b);
    sliceCenter = sortedZ[Math.floor(sortedZ.length/2)];
    $("atlas-search").value=""; $("atlas-distance").value="100";
    $("atlas-view").value="slice"; $("atlas-thickness").value="6";
    neighborhoodCenter=null;
    applyFilters();
    resetCamera();
    updateSelectionPanel();
    renderNotes();
    $("universe-status").textContent = `${catalog.records.length.toLocaleString("en")} real ${kind}`;
    scheduleDraw();
  }

  function pickAt(clientX, clientY) {
    if (!catalog?.records?.length) return;
    const canvas = $("universe-canvas");
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < catalog.records.length; i++) {
      if (projZ[i] <= 0) continue;
      const dist = Math.hypot(projX[i] - mx, projY[i] - my);
      if (dist <= 12) {
        const score = dist + projZ[i] * 1e-6;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    selected = bestIdx >= 0 ? catalog.records[bestIdx] : null;
    updateSelectionPanel();
    renderResults();
    scheduleDraw();
  }

  function bindCanvas() {
    const canvas = $("universe-canvas");
    let drag = null;
    canvas.addEventListener("pointerdown", event => {
      drag = {
        x: event.clientX,
        y: event.clientY,
        yaw: cam.yaw,
        pitch: cam.pitch,
        target: [...cam.target],
        pan: event.shiftKey || event.button === 2,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointermove", event => {
      if (!drag) {
        if (!catalog?.records?.length) return;
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        let bestIdx = -1;
        let bestDist = 11;
        for (let i = 0; i < catalog.records.length; i++) {
          if (projZ[i] <= 0) continue;
          const dist = Math.hypot(projX[i] - mx, projY[i] - my);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx !== hoveredIndex) {
          hoveredIndex = bestIdx;
          scheduleDraw();
        }
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.pan || event.shiftKey) {
        const view = basis();
        const rect = canvas.getBoundingClientRect();
        const worldPerPixel = (2 * cam.distance * Math.tan((cam.fovDeg * Math.PI) / 360)) / Math.max(1, Math.min(rect.width, rect.height));
        cam.target = [
          drag.target[0] - (dx * view.right[0] - dy * view.up[0]) * worldPerPixel,
          drag.target[1] - (dx * view.right[1] - dy * view.up[1]) * worldPerPixel,
          drag.target[2] - (dx * view.right[2] - dy * view.up[2]) * worldPerPixel,
        ];
      } else {
        cam.yaw = drag.yaw - dx * 0.0065;
        cam.pitch = clamp(drag.pitch + dy * 0.0065, -1.52, 1.52);
      }
      scheduleDraw();
    });
    canvas.addEventListener("pointerup", event => {
      if (!drag) return;
      if (!drag.moved) pickAt(event.clientX, event.clientY);
      drag = null;
    });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const cfg = defaultsFor(kind);
      cam.distance = clamp(cam.distance * Math.exp(event.deltaY * 0.0012), cfg.minDist, cfg.maxDist);
      scheduleDraw();
    }, { passive: false });
  }

  $("atlas-view").onchange = () => {
    if ($("atlas-view").value === "nearby") {
      if (!selected) { $("atlas-view").value="slice"; $("atlas-browser-note").textContent="Select an object first, then choose Selected neighborhood."; return; }
      neighborhoodCenter=[...positionOf(selected)]; $("atlas-distance").value="10";
    } else $("atlas-distance").value="100";
    applyFilters(true);
  };
  for (const id of ["atlas-distance","atlas-thickness"]) $(id).oninput=()=>applyFilters();
  $("atlas-search").oninput=()=>applyFilters();
  $("atlas-sort").onchange=()=>applyFilters();
  $("atlas-grid").onchange=scheduleDraw;
  $("atlas-fit").onclick=fitVisible;
  $("atlas-prev-page").onclick=()=>{page=Math.max(0,page-1);renderResults();};
  $("atlas-next-page").onclick=()=>{page=Math.min(Math.ceil(results.length/pageSize)-1,page+1);renderResults();};
  $("atlas-zoom-in").onclick=()=>{cam.distance=Math.max(defaultsFor(kind).minDist,cam.distance*.7);scheduleDraw();};
  $("atlas-zoom-out").onclick=()=>{cam.distance=Math.min(defaultsFor(kind).maxDist,cam.distance/ .7);scheduleDraw();};
  $("atlas-top").onclick=()=>{cam.pitch=1.52;cam.yaw=0;fitVisible();};

  $("universe-kind").onchange = () => loadCatalog($("universe-kind").value);
  $("reset-universe").onclick = resetCamera;
  $("universe-errors").onchange = scheduleDraw;
  $("universe-year").oninput = () => {
    $("universe-year-value").textContent = $("universe-year").value;
    applyFilters();
    updateSelectionPanel();
    scheduleDraw();
  };
  $("focus-object").onclick = () => {
    if (!selected) return;
    cam.target = [...positionOf(selected)];
    const minFocus = kind === "stars"
      ? Math.max(1.5, (selected.distance_error || 0.2) * 12, selected.distance * 0.06)
      : Math.max(40, (selected.distance_error || 2) * 25, selected.distance * 0.14);
    cam.distance = Math.min(cam.distance, minFocus);
    scheduleDraw();
  };
  $("open-object").onclick = () => {
    if (!selected) return;
    const isStar = kind === "stars";
    window.dispatchEvent(new CustomEvent("universe-open-object", {
      detail: {
        kind,
        id: selected.id,
        name: selected.name,
        ra: isStar ? (selected.spherex_ra ?? selected.ra) : selected.ra,
        dec: isStar ? (selected.spherex_dec ?? selected.dec) : selected.dec,
        catalog_ra: selected.ra,
        catalog_dec: selected.dec,
        epoch: isStar ? (selected.spherex_position_epoch ?? selected.epoch) : null,
        redshift: isStar ? 0 : selected.redshift,
        has_3d_velocity: Boolean(selected.velocity),
        distance: selected.distance,
        unit: catalog?.unit || (isStar ? "pc" : "Mpc"),
      },
    }));
  };
  $("universe-export").onclick = () => {
    if (!selected || !catalog) return;
    const payload = {
      exported_utc: new Date().toISOString(),
      catalog: {
        kind: catalog.kind,
        source: catalog.source,
        source_url: catalog.source_url,
        unit: catalog.unit,
        distance_kind: catalog.distance_kind,
        epoch: catalog.epoch ?? null,
        cosmology: catalog.cosmology ?? null,
        raw_sha256: catalog.raw_sha256,
        notes: catalog.notes,
      },
      selected,
      projected_year: kind === "stars" ? currentYear() : null,
      projected_xyz: positionOf(selected),
    };
    download(`spherex-3d-${kind}-${selected.id}.json`, JSON.stringify(payload, null, 2), "application/json");
  };

  document.addEventListener("keydown", event => {
    if ($("universe-workspace").hidden) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "q", "e"].includes(key)) return;
    event.preventDefault();
    const view = basis();
    const step = cam.distance * 0.06;
    const move = vec => {
      cam.target = [cam.target[0] + vec[0] * step, cam.target[1] + vec[1] * step, cam.target[2] + vec[2] * step];
      scheduleDraw();
    };
    if (key === "w") move(view.forward);
    if (key === "s") move([-view.forward[0], -view.forward[1], -view.forward[2]]);
    if (key === "d") move(view.right);
    if (key === "a") move([-view.right[0], -view.right[1], -view.right[2]]);
    if (key === "e") move(view.up);
    if (key === "q") move([-view.up[0], -view.up[1], -view.up[2]]);
  });

  window.addEventListener("workspace-mode-changed", event => {
    if (event.detail?.mode === "universe") {
      const targetKind = $("universe-kind").value || kind;
      if (!catalog || catalog.kind !== targetKind) loadCatalog(targetKind);
      else scheduleDraw();
    }
  });

  new ResizeObserver(scheduleDraw).observe($("universe-canvas"));
  bindCanvas();

  return { loadCatalog, resetCamera, screenPoint: i => (i >= 0 && i < projZ.length && projZ[i] > 0 ? [projX[i], projY[i], projZ[i]] : null) };
})();

