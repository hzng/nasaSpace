"use strict";
const LightLab = (() => {
  let result=null, point=null, mode="spectrum", generation=0, shownRows=50, openingPoint=false, lastSessionKey=null;
  const svgNS="http://www.w3.org/2000/svg";
  const fmt=v => v == null || !Number.isFinite(Number(v)) ? "—" : (Math.abs(v)>=10000 || (Math.abs(v)>0 && Math.abs(v)<.01) ? Number(v).toExponential(2) : Number(v).toLocaleString("en",{maximumFractionDigits:3}));
  function svg(tag,attrs={},text) {
    const element=document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
    if (text!=null) element.textContent=text;
    return element;
  }
  function note(message) { $("light-status").textContent=message; }
  const subscript=s => String(s).replace(/\d/g,d=>"₀₁₂₃₄₅₆₇₈₉"[d]);
  // Round axis steps (1, 2, 2.5 or 5 × 10ⁿ) so tick labels read as plain numbers
  function ticks(min,max,count=5) {
    const raw=(max-min)/count, mag=10**Math.floor(Math.log10(raw));
    const step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=raw*(1-1e-9));
    const out=[];
    for(let k=Math.ceil(min/step-1e-9);k<=Math.floor(max/step+1e-9);k++) out.push(Number((k*step).toPrecision(12)));
    return out;
  }
  // With no clicked pixel, measure the named target when the session knows where it is: the bare field centre is often empty sky
  function defaultSelection() {
    const frames=state.session?.frames||[];
    const i=frames[state.index]?.marker ? state.index : frames.findIndex(f=>f.marker);
    if (i>=0) return {x:frames[i].marker[0],y:frames[i].marker[1],frame:i,label:`${state.title} guide position, ${dateText(frames[i].timestamp)}`};  // a mover's guide is only valid on its own date
    const at=frames[state.index] ? targetAt(frames[state.index]) : null;
    if (at) return {x:at[0],y:at[1],frame:state.index,label:`${state.title} position`};
    return {x:.5,y:.5,frame:state.index,label:"Field centre · click the image to choose a point"};
  }
  function showDefault() { $("light-position").textContent=defaultSelection().label; }
  function invalidate(session) {
    generation++; result=null; point=null; $("light-result").hidden=true;
    showDefault();
    note(session && !session.frames?.length
      ? "Open sky first"
      : "Ready");
  }
  window.addEventListener("sky-session-ready",event => {
    const session=event.detail;
    const nextKey=session?.options ? `${Number(session.options.ra).toFixed(7)},${Number(session.options.dec).toFixed(7)},${session.options.fov}` : null;
    if (openingPoint) { lastSessionKey=nextKey; return; }
    if (nextKey!==lastSessionKey) {
      lastSessionKey=nextKey;
      invalidate(session);
      return;
    }
    if (point && session?.frames?.length && !state.point) {
      state.point={x:point.x,y:point.y};
      draw();
    }
    if (result && $("light-scope").value==="dates") {
      note("Dates changed");
    }
  });
  window.addEventListener("sky-point-picked",event => {
    generation++; point=event.detail;
    $("light-position").textContent=`${point.ra.toFixed(4)}°, ${point.dec.toFixed(4)}°`;
    if (result) note("Point changed");
  });
  window.addEventListener("star-track-ready",event => {
    const t = event.detail;
    if (t?.points?.length) {
      if ($("light-track-toggle-wrap")) $("light-track-toggle-wrap").hidden = false;
      const name = t.ephemeris?.object || t.catalog?.name || $("track-object")?.value.trim() || 'target';
      if ($("light-track-obj-name")) $("light-track-obj-name").textContent = name;
      note(`Track ready for ${name}. Light measurement follows moving path.`);
    }
  });
  $("light-center").onclick=() => { point=null; generation++; showDefault(); };

  async function measure(opts={}) {
    if (!state.session?.frames.length || state.loading) { note("Open sky first"); return; }
    const version=++generation;
    const track = typeof StarTracker !== 'undefined' && StarTracker.getResult ? StarTracker.getResult() : null;
    const followTrack = Boolean(opts.follow_track || ($("light-follow-track")?.checked && track?.points?.length));
    const selection=point || defaultSelection();
    const trackName = track?.ephemeris?.object || track?.catalog?.name || $("track-object")?.value.trim() || 'Tracked target';
    const payload={session:state.session.id,frame:selection.frame ?? state.index,x:selection.x,y:selection.y,
      scope:$("light-scope").value,redshift:Number($("light-redshift").value),
      follow_track: followTrack,
      track_points: followTrack ? track.points : undefined,
      track_object: followTrack ? trackName : undefined};
    $("measure-light").disabled=true;
    if ($("track-spectrum")) $("track-spectrum").disabled = true;
    note(followTrack ? `Measuring ${trackName} along track…` : "Measuring…");
    try {
      const job=await api("/observation-lab/api/spectrum",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      while (true) {
        const progress=await api(`/observation-lab/api/jobs/${job.id}`);
        if (progress.status==="failed") throw new Error(progress.stage);
        if (progress.status==="complete") {
          if (version!==generation) { note("Cancelled"); break; }
          result=progress.result; shownRows=50;
          $("light-result").hidden=false;
          const coords=`${result.ra.toFixed(4)}°, ${result.dec.toFixed(4)}°`;
          $("light-position").textContent=selection.label ? `${selection.label.split(" · ")[0]} · ${coords}` : coords;
          const measured=result.points.filter(p=>Number.isFinite(p.flux));
          const clean=measured.filter(p=>p.chemical_eligible);
          const dates=measured.map(p=>p.timestamp.slice(0,10)).sort();
          note(`${measured.length} point${measured.length===1?"":"s"} · ${clean.length} clean`+(payload.scope==="near" && measured.length<=3 ? " · Few points in ±7 days: try All dates" : ""));
          $("light-status").title=dates.length ? `${dates[0]} to ${dates.at(-1)} UTC` : "";
          render(); renderCandidates(); renderTable();
          $("light-sources").replaceChildren();
          result.references.forEach((href,index)=>{const link=document.createElement("a");link.href=href;link.target="_blank";link.rel="noreferrer";link.textContent=`Ref ${index+1} ↗`;$("light-sources").append(link);});
          window.dispatchEvent(new CustomEvent("chemical-point-measured",{detail:{ra:result.ra,dec:result.dec,candidates:result.candidates.filter(c=>c.candidate)}}));
          break;
        }
        if (version===generation) note(progress.stage);
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    } catch(error) { if(version===generation) note(error.message); }
    finally {
      $("measure-light").disabled=false;
      if ($("track-spectrum")) $("track-spectrum").disabled = false;
    }
  }

  function selectedPoints() {
    if (!result) return [];
    const release=$("light-release").value;
    let rows=result.points.filter(p=>Number.isFinite(p.flux)&&Number.isFinite(p.flux_error)&&Number.isFinite(p.wavelength));
    rows=rows.filter(p=>(release==="all" || p.release.startsWith(release))&&($("light-review").checked||p.chemical_eligible));
    if(mode==="time") {
      const center=Number($("time-wave").value),tolerance=Number($("time-tolerance").value);
      rows=rows.filter(p=>Math.abs(p.wavelength-center)<=tolerance && p.bandwidth<=2*tolerance);
    }
    return rows;
  }

  function render() {
    if(!result) return;
    const axis=document.getElementById("light-axis-x");
    axis.textContent=mode==="spectrum"?"Across · Wavelength in micrometers (µm). Farther right is longer-wavelength infrared light.":"Across · Observation date in UTC. The wavelength window keeps the comparison within a narrow band.";
    document.getElementById("light-dip-guide").hidden=mode==="time";
    const chart=$("light-chart"); chart.replaceChildren();
    chart.append(svg("rect",{width:1000,height:390,fill:"#000000"}));
    const rows=selectedPoints();
    if(!rows.length) {
      chart.append(svg("text",{x:500,y:170,"text-anchor":"middle",fill:"#eab354","font-size":20,"font-weight":700},"No data"));
      chart.append(svg("text",{x:500,y:200,"text-anchor":"middle",fill:"#a1a1a6","font-size":13},"Adjust filters"));
      $("plot-note").textContent="Empty filter result";
      chart.setAttribute("aria-label","Measured light chart: no points match the current filters");
      return;
    }
    const L=96,R=968,T=42,B=326;
    let xmin=.75,xmax=5;
    if(mode==="time") { xmin=Math.min(...rows.map(p=>p.mjd));xmax=Math.max(...rows.map(p=>p.mjd));if(xmax-xmin<1){xmin-=.5;xmax+=.5;} }
    let ymin=Math.min(0,...rows.map(p=>p.flux-p.flux_error)),ymax=Math.max(...rows.map(p=>p.flux+p.flux_error));
    if(ymax<=ymin) ymax=ymin+1;
    const pad=(ymax-ymin)*.08; ymin-=pad; ymax+=pad;
    const x=v=>L+(v-xmin)/(xmax-xmin)*(R-L),y=v=>B-(v-ymin)/(ymax-ymin)*(B-T);
    const defs=svg("defs"),clip=svg("clipPath",{id:"plot-clip"});clip.append(svg("rect",{x:L,y:T,width:R-L,height:B-T}));defs.append(clip);chart.append(defs);
    if(mode==="spectrum") for(const feature of result.candidates) {
      const z=1+result.redshift,start=feature.band[0]*z,end=feature.band[1]*z;
      if(start<xmax&&end>xmin) {
        chart.append(svg("rect",{x:x(Math.max(start,xmin)),y:T,width:x(Math.min(end,xmax))-x(Math.max(start,xmin)),height:B-T,fill:feature.color,opacity:.065}));
        const labelX=Math.min(R-12,Math.max(L+12,x(feature.center*z)));
        chart.append(svg("text",{x:labelX,y:24,"text-anchor":"middle",fill:feature.color,"font-size":11},subscript(feature.formula)));
      }
    }
    chart.append(svg("line",{x1:L,y1:B,x2:R,y2:B,stroke:"#2c2c2e","stroke-width":1}));
    for(const v of ticks(ymin,ymax)) {
      chart.append(svg("line",{x1:L,y1:y(v),x2:R,y2:y(v),stroke:"#2c2c2e","stroke-width":1,"stroke-dasharray":v===0?"":"3 4"}));
      chart.append(svg("text",{x:L-12,y:y(v)+4,"text-anchor":"end",fill:"#a1a1a6","font-size":12},fmt(v)));
    }
    for(const xv of mode==="time" ? [0,1,2,3,4,5].map(i=>xmin+(xmax-xmin)*i/5) : ticks(xmin,xmax)) {
      const label=mode==="time"?new Date((xv-40587)*86400000).toISOString().slice(0,10):fmt(xv);
      chart.append(svg("text",{x:x(xv),y:B+25,"text-anchor":"middle",fill:"#a1a1a6","font-size":12},label));
    }
    chart.append(svg("text",{x:530,y:376,"text-anchor":"middle",fill:"#f5f5f7","font-size":13},mode==="spectrum"?"Wavelength (µm)":"Date (UTC)"));
    chart.append(svg("text",{x:20,y:185,transform:"rotate(-90 20 185)","text-anchor":"middle",fill:"#f5f5f7","font-size":13},"Flux (µJy)"));
    const dots=svg("g",{"clip-path":"url(#plot-clip)"});
    for(const p of rows) {
      const px=x(mode==="time"?p.mjd:p.wavelength),py=y(p.flux),color=hues[p.detector-1];
      const review=!p.chemical_eligible;
      dots.append(svg("line",{x1:px,y1:y(p.flux-p.flux_error),x2:px,y2:y(p.flux+p.flux_error),stroke:color,opacity:review?.4:.8}));
      if(mode==="spectrum") dots.append(svg("line",{x1:x(p.wavelength-p.bandwidth/2),y1:py,x2:x(p.wavelength+p.bandwidth/2),y2:py,stroke:color,opacity:.25}));
      const dot=svg(review?"path":"circle",review?{d:`M${px-3.5},${py-3.5}l7,7m0,-7l-7,7`,stroke:color,"stroke-width":1.5,fill:"none"}:{cx:px,cy:py,r:4,fill:color,stroke:"#000000","stroke-width":.8});
      const description=`${p.timestamp} · D${p.detector} · ${p.release}\n${p.wavelength.toFixed(4)} µm · ${fmt(p.flux)} ± ${fmt(p.flux_error)} µJy\nFit residual ${fmt(p.fit_quality)} · ${p.reason||"Passed"}\n${p.id}`;
      dot.append(svg("title",{},description));dot.setAttribute("aria-label",description);dot.setAttribute("tabindex","0");dot.setAttribute("role","button");dot.style.cursor="pointer";
      dot.onclick=()=>openPoint(p);dot.onkeydown=e=>{if(e.key==="Enter")openPoint(p);};dots.append(dot);
    }
    chart.append(dots);
    const warning=rows.filter(p=>!p.chemical_eligible).length;
    $("plot-note").textContent=`${rows.length} point${rows.length===1?"":"s"} · ${warning} flagged`;
    const span=(values,f)=>{const lo=f(Math.min(...values)),hi=f(Math.max(...values));return lo===hi?lo:`${lo} to ${hi}`;};
    const xText=mode==="spectrum"?`wavelength ${span(rows.map(p=>p.wavelength),v=>v.toFixed(2))} µm`:`dates ${span(rows.map(p=>p.mjd),v=>new Date((v-40587)*86400000).toISOString().slice(0,10))}`;
    chart.setAttribute("aria-label",`${mode==="spectrum"?"Spectrum":"Flux over time"}: ${rows.length} point${rows.length===1?"":"s"} (${warning} flagged), ${xText}, flux ${span(rows.map(p=>p.flux),fmt)} µJy`);
  }

  async function openPoint(p) {
    if(state.loading) { note("Wait for load"); return; }
    if(!state.session) { note("Open sky first"); return; }
    const savedPoint=point ? {...point} : null;
    if(Number($("detector").value)!==p.detector) {
      $("detector").value=String(p.detector);
      openingPoint=true;
      try { await search(); }
      finally { openingPoint=false; }
    }
    point=savedPoint;
    if(savedPoint && state.session?.frames?.length && !state.point) {
      state.point={x:savedPoint.x,y:savedPoint.y};
      draw();
    }
    const index=state.session?.frames.findIndex(frame=>frame.id===p.id&&frame.detector===p.detector);
    if(index>=0) {
      stop();setFrame(index);$("viewers").scrollIntoView({behavior:"smooth",block:"nearest"});
      note(`Opened ${p.timestamp.slice(0,10)} · D${p.detector}`);
    } else {
      const excluded=state.session?.excluded_frames?.find(frame=>frame.id===p.id&&frame.detector===p.detector);
      note(excluded ? `Excluded · ${excluded.reason}` : "Outside filters");
    }
  }

  function renderCandidates() {
    const parent=$("chemical-candidates");parent.replaceChildren();
    const checked=result.candidates.filter(c=>c.evidence), unchecked=result.candidates.filter(c=>!c.evidence);
    if(unchecked.length) {
      // One muted line instead of a card per band that had too few points to test
      const line=document.createElement("p");line.className="candidate-summary";
      line.textContent=checked.length
        ? `No dip check for ${unchecked.map(c=>subscript(c.formula)).join(", ")}: too few points near ${unchecked.length===1?"this band":"these bands"}.`
        : `No dip checks possible: too few points near these bands.${$("light-scope").value==="all"?"":" Try All dates."}`;
      line.title=unchecked.map(c=>`${c.formula}: ${c.status}\n${c.caution}`).join("\n\n");
      parent.append(line);
    }
    for(const candidate of checked) {
      const card=document.createElement("article");card.className="candidate-card"+(candidate.candidate?" candidate-found":"");
      const title=document.createElement("h4"),statusText=document.createElement("strong"),sub=document.createElement("small");
      const shifted=candidate.center*(1+(result.redshift||0));
      title.textContent=result.redshift>0
        ? `${subscript(candidate.formula)} · ${shifted.toFixed(2)} µm`
        : `${subscript(candidate.formula)} · ${candidate.center.toFixed(2)} µm`;
      title.style.color=candidate.color;
      const isEm = candidate.kind === "emission";
      statusText.textContent=candidate.evidence
        ? (candidate.candidate ? `${candidate.evidence.significance.toFixed(1)}σ ${isEm ? "peak" : "dip"}` : (isEm ? "No peak" : "No dip"))
        : "Low coverage";
      sub.textContent=candidate.evidence ? `${candidate.evidence.points} pts · ${candidate.evidence.release}` : "Need continuum";
      card.title=`${candidate.status}\n${candidate.caution}`;
      card.append(title,statusText,sub);parent.insertBefore(card,parent.querySelector(".candidate-summary"));
    }
  }

  function renderTable() {
    const parent=$("measurement-table");parent.replaceChildren();
    const table=document.createElement("table"),head=document.createElement("thead"),row=document.createElement("tr");
    for(const label of ["Date","Band","µm","Flux (µJy)","Status"]){const th=document.createElement("th");th.textContent=label;row.append(th);}head.append(row);table.append(head);
    const body=document.createElement("tbody");
    result.points.slice(0,shownRows).forEach(p=>{
      const tr=document.createElement("tr");
      const fluxText=p.flux==null?"—":`${fmt(p.flux)} ± ${fmt(p.flux_error)}`;
      const prefix=p.tracking_linked ? (p.prediction_only ? "[Pred] " : "[Tracked] ") : "";
      const statusText=prefix + (p.reason || "OK");
      for(const value of [p.timestamp.slice(0,10),`D${p.detector} · ${p.release}`,fmt(p.wavelength),fluxText,statusText]){
        const td=document.createElement("td");td.textContent=value;tr.append(td);
      }
      body.append(tr);
    });
    table.append(body);parent.append(table);$("more-measurements").hidden=shownRows>=result.points.length;
  }
  window.measureLight=measure;
  $("measure-light").onclick=()=>measure();
  $("more-measurements").onclick=()=>{shownRows+=100;renderTable();};
  for(const id of ["light-review","light-release","time-wave","time-tolerance"])$(id).onchange=render;
  $("light-redshift").onchange=()=>{if(result) note("Redshift updated");};
  $("light-scope").onchange=()=>{
    if($("light-scope").value==="all") note("All dates can mean thousands of files and several minutes per measurement.");
    else if(result) note("Window updated");
  };
  for(const name of ["spectrum","time"])$("plot-"+name).onclick=()=>{
    mode=name;for(const value of ["spectrum","time"])$("plot-"+value).setAttribute("aria-pressed",String(value===mode));
    $("time-wave-label").hidden=$("time-tolerance-label").hidden=mode!=="time";render();
  };
  $("light-csv").onclick=()=>{if(!result)return;const columns=["id","detector","release","timestamp","mjd","wavelength","bandwidth","flux","flux_error","fit_quality","accepted","chemical_eligible","flags","reason","source"];const quote=v=>'"'+String(v??"").replaceAll('"','""')+'"';download("spherex-light-measurements.csv",[columns.join(","),...result.points.map(p=>columns.map(c=>quote(p[c])).join(","))].join("\n"),"text/csv");};
  $("light-json").onclick=()=>{if(result)download("spherex-light-analysis.json",JSON.stringify(result,null,2),"application/json");};
  $("light-svg").onclick=()=>{if(result)download("spherex-light-graph.svg",new XMLSerializer().serializeToString($("light-chart")),"image/svg+xml");};
  return {measure,invalidate};
})();
