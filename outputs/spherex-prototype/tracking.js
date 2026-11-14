"use strict";
const StarTracker = (() => {
  let result=null, choice=null, anchor2=null, awaitingAnchor2=false, version=0, timer=null, yaw=.6, pitch=.3, zoom=1;
  // Conditions mirror tracking.py: Gaia match only for non-ephemeris, non-anchor targets (lines 516-518, 240),
  // and xyz only when parallax/error > 20 and RUWE < 1.4 (lines 243-244); tracking.js enables the button on catalog.xyz.
  const HELP_IDLE="Pick 2nd needs a clicked point first. 3D motion needs a tracked Gaia star with a reliable distance.";
  const setText=(id,val)=>{const el=$(id);if(el)el.textContent=val;};
  const PRED='#b9a3f5', BAD='#f0806e';
  let typedObject=false;
  // A named object is tracked at its JPL position (tracking.py warns about the click distance only afterwards), so say so up front
  const noteObject=()=>{const v=$("track-object").value.trim();$("track-object-note").hidden=!v;setText("track-object-note",`Tracks ${v} at its JPL-predicted position, not the pixel you click.`);};
  const prefillObject=()=>{if(!typedObject)$("track-object").value=state.field==='vesta'?'Vesta':'';noteObject();};
  // Busy state: Track point says it is working and Clear becomes Cancel; clear() and the run's end restore both
  // While busy, #track-status shows each stage silently; the hidden announcer speaks only start, finish and failure
  const announcer=document.createElement("p");announcer.className="sr-only";announcer.setAttribute("role","status");$("track-status").after(announcer);
  const announce=msg=>{announcer.textContent=msg;};
  const setBusy=busy=>{$("track-star").textContent=busy?"Tracking…":"Track point";setText("track-clear",busy?"Cancel":"Clear");$("track-status")[busy?"removeAttribute":"setAttribute"]("role","status");};
  // Editing the object invalidates a running request, so its answer is never shown under the new name
  $("track-object").addEventListener('input',()=>{typedObject=true;noteObject();version++;if($("track-star").disabled){$("track-star").disabled=false;setBusy(false);$("track-status").textContent="Object changed. Press Track point to run again.";}});
  const compass=deg=>['N','NE','E','SE','S','SW','W','NW'][Math.round(((deg%360)+360)%360/45)%8];

  const fmtSpeed=m=>m.preferred_unit==='hr'?`${m.speed_arcsec_per_hr.toFixed(1)} ″/hr`:`${m.speed_arcsec_per_year.toFixed(2)} ″/yr`;
  const fmtHead=m=>`${m.heading_deg.toFixed(0)}° ${compass(m.heading_deg)}`;

  function resetAnchorBtn(){
    awaitingAnchor2=false;
    const btn=$("track-anchor");
    if(btn){btn.setAttribute("aria-pressed","false");btn.disabled=!choice;}
  }

  function clear() {
    version++;result=null;choice=null;anchor2=null;
    dropCard();$("track-path").hidden=true;
    resetAnchorBtn();
    $("track-result").hidden=true;
    $("track-3d").disabled=true;
    setText("track-help",HELP_IDLE);
    $("track-star").disabled=false;setBusy(false);
    $("vesta-callout").hidden=false;
    $("track-status").textContent="Click a star or asteroid, then track its path.";$("track-status").classList.remove("track-error");
    setText("track-kind-pill","Ready");
    setText("kpi-speed","—");setText("kpi-heading","—");setText("kpi-change","—");setText("kpi-points","—");
    draw();
    updateLegend();
  }

  window.addEventListener("sky-session-ready",()=>{clear();prefillObject();});
  window.addEventListener("sky-point-picked",event=>{
    if(awaitingAnchor2 && choice && event.detail.frame !== choice.frame){
      anchor2=event.detail;
      resetAnchorBtn();
      $("track-status").textContent=`Anchor 2 locked (frame ${anchor2.frame+1}). Ready to track moving path.`;
      return;
    }
    // Stepping frames re-inspects the same pixel; that must not wipe a finished track.
    if(result&&choice&&event.detail.x===choice.x&&event.detail.y===choice.y)return;
    clear();
    choice=event.detail;
    if($("track-anchor"))$("track-anchor").disabled=false;
    $("track-status").textContent=`Selected ${choice.ra.toFixed(5)}°, ${choice.dec.toFixed(5)}°. Ready to track.`;
  });

  $("track-clear").onclick=clear;
  if($("track-anchor")){
    $("track-anchor").onclick=()=>{
      if(!choice){$("track-status").textContent="Pick the object on frame 1 first.";return;}
      awaitingAnchor2=!awaitingAnchor2;
      $("track-anchor").setAttribute("aria-pressed",String(awaitingAnchor2));
      $("track-status").textContent=awaitingAnchor2?"Step to another frame and click the moving object for Anchor 2.":"Anchor 2 canceled.";
    };
  }

  $("track-star").onclick=async()=>{
    if(!state.session?.frames.length)return;
    const obj=$("track-object").value.trim();
    if(!choice&&!obj){$("track-status").textContent="Click a star or moving object in the image first, or type a Solar System object.";return;}
    const token=++version;$("track-star").disabled=true;setBusy(true);$("track-status").classList.remove("track-error");announce("Tracking started.");
    // The walkthrough card has done its job once a track starts; it returns on Clear or a new pick
    $("vesta-callout").hidden=true;
    // Drop the previous result first: a failed rerun must not leave an earlier success on screen
    result=null;$("track-result").hidden=true;$("track-3d").disabled=true;draw();
    try{
      const body={session:state.session.id,frame:choice?choice.frame:state.index};
      if(choice){body.x=choice.x;body.y=choice.y;}
      if(obj)body.object=obj;
      if(anchor2&&!obj)body.anchor2={frame:anchor2.frame,x:anchor2.x,y:anchor2.y};
      const job=await api('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      while(token===version){
        const status=await api('/api/jobs/'+job.id);if(token!==version)return;
        $("track-status").textContent=status.stage;
        if(status.status==='failed')throw new Error(status.stage);
        if(status.status==='complete'){
          result=status.result;render();draw();announce("Track ready. "+$("track-status").textContent);
          // A fixed sky patch holds the object in only a few frames: open on one of them
          const hit=result.ephemeris&&!result.points.find(p=>p.index===state.index)?.accepted&&result.points.find(p=>p.accepted);
          if(hit)setFrame(hit.index);
          // The verdict is the payoff: bring it into view in the side panel's own scroll
          $("track-verdict").scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,600));
      }
    }catch(e){if(token===version){$("track-status").textContent=e.message;$("track-status").classList.add("track-error");announce("Tracking failed. "+e.message);}}
    finally{if(token===version){$("track-star").disabled=false;setBusy(false);}}
  };

  function svgEl(parent,tag,attrs,text){
    const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
    if(text)n.textContent=text;
    parent.append(n);
    return n;
  }

  function renderChangeChart(){
    const svg=$("track-change-plot");
    if(!svg)return;
    svg.replaceChildren();
    const segs=result.segments||[];
    if(!segs.length){
      svgEl(svg,'text',{x:200,y:78,fill:'#86868b','font-size':11,'text-anchor':'middle'},'Need 2+ distinct epochs for speed & change curve');
      svg.setAttribute('aria-label','Cumulative path and interval speed over time: needs 2 or more distinct epochs, none plotted.');
      return;
    }
    const useHr=result.motion?.preferred_unit==='hr';
    const speeds=segs.map(s=>useHr?s.speed_arcsec_per_hr:s.speed_arcsec_per_yr);
    const maxCum=Math.max(1e-3,...segs.map(s=>s.cumulative_arcsec));
    const maxSpd=Math.max(1e-3,...speeds);
    const t0=segs[0].mjd_start, span=Math.max(1e-3,segs[segs.length-1].mjd_end-t0);
    const x0=44,x1=360,yTop=18,yBot=118;
    svgEl(svg,'path',{d:`M${x0} ${yBot}H${x1} M${x0} ${yTop}V${yBot}`,stroke:'#3a3a3c','stroke-width':1});
    // Step speed bars (cyan)
    const barW=Math.max(6,Math.min(26,(x1-x0)/Math.max(2,segs.length)*0.55));
    for(let i=0;i<segs.length;i++){
      const s=segs[i], sp=speeds[i];
      const cx=x0+(s.mjd_mid-t0)/span*(x1-x0);
      const bh=(sp/maxSpd)*(yBot-yTop-6);
      const bar=svgEl(svg,'rect',{x:(cx-barW/2).toFixed(1),y:(yBot-bh).toFixed(1),width:barW.toFixed(1),height:bh.toFixed(1),rx:2,fill:'#71d9f6','fill-opacity':.32,stroke:'#71d9f6','stroke-opacity':.7,tabindex:0,role:'button','aria-label':`${s.timestamp} speed ${sp.toFixed(2)}`});
      bar.onclick=()=>setFrame(s.to_index);
      const t=document.createElementNS('http://www.w3.org/2000/svg','title');
      t.textContent=`${s.timestamp.slice(0,16)} · Step ${sp.toFixed(2)} ${useHr?'″/hr':'″/yr'} · Total ${s.cumulative_arcsec.toFixed(1)}″ · PA ${s.pa_deg.toFixed(0)}°`;
      bar.append(t);
    }
    // Cumulative displacement curve (amber)
    let pathD=`M${x0} ${yBot}`;
    for(const s of segs){
      const px=x0+(s.mjd_end-t0)/span*(x1-x0);
      const py=yBot-(s.cumulative_arcsec/maxCum)*(yBot-yTop-6);
      pathD+=` L${px.toFixed(1)} ${py.toFixed(1)}`;
    }
    svgEl(svg,'path',{d:pathD,fill:'none',stroke:'#eab354','stroke-width':2.2,'stroke-linecap':'round','stroke-linejoin':'round'});
    for(const s of segs){
      const px=x0+(s.mjd_end-t0)/span*(x1-x0);
      const py=yBot-(s.cumulative_arcsec/maxCum)*(yBot-yTop-6);
      const dot=svgEl(svg,'circle',{cx:px.toFixed(1),cy:py.toFixed(1),r:3.5,fill:'#eab354',tabindex:0,role:'button'});
      dot.onclick=()=>setFrame(s.to_index);
    }
    svgEl(svg,'text',{x:x0,y:138,fill:'#eab354','font-size':10},`Path 0→${maxCum.toFixed(1)}″`);
    svgEl(svg,'text',{x:x1,y:138,fill:'#71d9f6','font-size':10,'text-anchor':'end'},`Peak ${maxSpd.toFixed(2)} ${useHr?'″/hr':'″/yr'}`);
    svg.setAttribute('aria-label',`Cumulative path and interval speed over time: ${segs.length} step${segs.length===1?'':'s'} over ${span.toFixed(1)} days, path length ${maxCum.toFixed(1)}″, peak step speed ${maxSpd.toFixed(2)} ${useHr?'″/hr':'″/yr'}.`);
  }

  const f=(v,d=1)=>v==null?'n/a':Number(v).toFixed(d);
  function predTip(p){
    if(!p.predicted_sky)return '';
    const r=p.rate_arcsec_per_hr;
    return `\nJPL predicted RA ${f(p.predicted_sky[0],5)}° Dec ${f(p.predicted_sky[1],5)}°`
      +(p.offset_arcsec!=null?`\nOffset (measured − predicted) ${f(p.offset_arcsec)}″ (E ${f(p.offset_east_arcsec)}″, N ${f(p.offset_north_arcsec)}″), tolerance ${f(p.tolerance_arcsec)}″${p.within_tolerance===false?' · OUTSIDE TOLERANCE':''}`:'')
      +(r?`\nRate ${f(r[0],2)}″/hr RA·cosDec, ${f(r[1],2)}″/hr Dec (apparent-coordinate rate at that instant; includes the spacecraft's orbital motion, so it is not the speed between exposures)`:'')
      +`\nDistance ${f(p.delta_au,3)} au · light time ${f(p.light_time_min)} min`;
  }
  function renderEphemeris(e){
    $("track-eph").hidden=!e;
    if(!e)return;
    setText("track-source",`${e.source} · ${e.object} · observer: ${e.observer} · retrieved ${(e.retrieved_utc||'').replace('T',' ').slice(0,16)} UTC${e.from_cache?' · cached':''}`);
    setText("track-timescale",`Time scale: ${e.time_scale}`);
    $("track-warnings").replaceChildren(...(e.warnings||[]).map(t=>{const li=document.createElement('li');li.textContent='Warning: '+t;return li;}));
    const flag=$("track-flag"), rule=`tolerance: ${e.tolerance_rule}`;
    flag.hidden=false;
    if(!e.compared){
      setText("track-offset",`No frame could be compared with a measurement; ${rule}`);
      flag.className='track-flag bad';flag.textContent='Prediction shown, not confirmed: no measured position to check it against.';
    }else{
      const total=result.points.length, missing=total-e.compared;
      const rest=missing?` · ${missing} of ${total} frames have no usable measurement, so the prediction is unconfirmed there`:'';
      setText("track-offset",`Offset median ${f(e.offset_median_arcsec)}″ · max ${f(e.offset_max_arcsec)}″ over ${e.compared} of ${total} frames · ${rule}`);
      flag.className='track-flag'+(e.flagged?' bad':missing?' partial':'');
      flag.textContent=e.flagged?`⚠ ${e.flagged} of ${e.compared} compared frames disagree with the ephemeris beyond tolerance${rest}`
        :missing?`${e.compared} of ${total} frames compared, all within tolerance${rest}`
        :`All ${total} frames agree with the ephemeris within tolerance`;
    }
  }

  function render(){
    const points=result.points.filter(p=>p.accepted).sort((a,b)=>a.mjd-b.mjd);
    const c=result.catalog, m=result.motion, ch=result.change;
    const kindLabel=result.target_kind==='asteroid'?'Asteroid':(c?'Gaia star':'Moving source');
    $("track-result").hidden=false;
    dropCard();
    const hasPath=result.points.some(p=>p.predicted);
    $("track-path").hidden=!hasPath;
    $("track-3d").disabled=!c?.xyz;
    setText("track-help",c?.xyz?"3D motion is ready for this Gaia star.":
      result.target_kind==='asteroid'?"3D motion is unavailable: Solar System and 2-frame targets are not matched to the Gaia catalog.":
      !c?"3D motion is unavailable: no unique Gaia DR3 match within 6.15″ of this source.":
      "3D motion is unavailable: the Gaia parallax is too uncertain (needs parallax over 20× its error and RUWE below 1.4).");
    if(!hasPath)setText("track-help",$("track-help").textContent+" No predicted path: this track had no catalog match, archived path or 2nd pick to predict from.");
    setText("track-kind-pill",kindLabel);
    updateLegend();
    const wingCount=points.filter(p=>p.fit_mode==='wing').length;
    const fitNote=wingCount?` (${wingCount} wing-fit)`:'';
    $("track-status").textContent=`${points.length} / ${result.points.length} measured${fitNote}. ${c?c.name:result.catalog_note}`;

    if(m){
      const useHr=m.preferred_unit==='hr';
      setText("kpi-speed",fmtSpeed(m));
      setText("kpi-heading",fmtHead(m));
    }else{
      setText("kpi-speed","—");setText("kpi-heading","—");
    }
    const eph=result.ephemeris, em=eph?.motion;
    setText("kpi-speed-pred",em?`predicted ${fmtSpeed(em)}`:"");
    setText("kpi-heading-pred",em?`predicted ${fmtHead(em)}`:"");
    // Verdict first: only the measured and predicted values already computed above
    const both=!!(m&&em);
    setText("verdict-head",!m?'Measure at least two epochs to fit velocity.'
      :both?`Speed within ${(Math.abs(m.speed_arcsec_per_year-em.speed_arcsec_per_year)/em.speed_arcsec_per_year*100).toFixed(1)}% of JPL`
      :`${fmtSpeed(m)} toward ${fmtHead(m)}`);
    $("verdict-head").classList.toggle("pending",!m);
    // The sample size is part of the claim, so it sits inside the headline; under 5 measured frames it reads as low confidence
    const low=!!m&&points.length<5;
    $("verdict-head").classList.toggle("low",low);
    if(m){
      const sample=document.createElement("span");sample.className="verdict-sample";
      sample.textContent=`${low?"Low confidence · ":""}${points.length} of ${result.points.length} frames measured`;
      $("verdict-head").append(sample);
    }
    $("verdict-compare").hidden=!both;
    $("track-kpis").classList.toggle("compared",both);
    if(both){
      setText("verdict-m-speed",fmtSpeed(m));setText("verdict-m-head",`toward ${fmtHead(m)}`);
      setText("verdict-p-speed",fmtSpeed(em));setText("verdict-p-head",`toward ${fmtHead(em)}`);
    }
    renderEphemeris(eph);
    setText("kpi-change",ch?ch.state:`${points.length>=2?'Linear':'Single epoch'}`);
    setText("kpi-points",`${points.length} / ${result.points.length} pts`);

    const driftMsg=m
      ?(m.preferred_unit==='hr'
        ?`Sky speed ${m.speed_arcsec_per_hr.toFixed(2)} ″/hr (${m.speed_arcsec_per_year.toFixed(0)} ″/yr) toward PA ${m.heading_deg.toFixed(0)}°, net ${m.net_arcsec.toFixed(1)}″ over ${(m.span_days*24).toFixed(1)}h. `
        :`Drift E ${m.east_arcsec_per_year.toFixed(2)} ± ${m.east_error.toFixed(2)}, N ${m.north_arcsec_per_year.toFixed(2)} ± ${m.north_error.toFixed(2)} ″/yr (net ${m.net_arcsec.toFixed(2)}″ over ${m.span_days.toFixed(0)}d). `)
      :'Measure at least two epochs to fit velocity. ';
    const chMsg=ch?`Change: ${ch.state} (speed ${ch.speed_delta>=0?'+':''}${ch.speed_delta_pct.toFixed(1)}%, turn ${ch.turn_deg>=0?'+':''}${ch.turn_deg.toFixed(1)}°). `:'';
    const gaiaMsg=c?.velocity?'Gaia 3D trajectory ready.':c?.xyz?'Gaia 3D position ready (no RV).':'';
    $("track-summary").textContent=driftMsg+chMsg+gaiaMsg;

    const svg=$("track-plot");svg.replaceChildren();
    const preds=eph?result.points.filter(p=>p.predicted_east_arcsec!=null).sort((a,b)=>a.mjd-b.mjd):[];
    // With no centroid at all the predicted path is still drawn, and the change chart never keeps an older result
    svg.setAttribute('aria-label','Sky trajectory relative to the reference observation: no measured or predicted positions to plot.');
    if(!points.length&&!preds.length){renderChangeChart();return;}
    const pext=p=>Math.max(Math.abs(p.predicted_east_arcsec),Math.abs(p.predicted_north_arcsec));
    const fit=Math.max(1,...points.map(p=>Math.max(Math.abs(p.east_arcsec),Math.abs(p.north_arcsec))+p.error_arcsec));
    // Axes follow the measured points; a prediction reaching far past them is clipped instead of shrinking them to one dot
    const span=points.length?Math.max(fit,...preds.map(pext).filter(v=>v<=3*fit)):Math.max(1,...preds.map(pext));
    const offPlot=preds.some(p=>pext(p)>span*1.25);
    const scale=64/span, ox=200, oy=82;
    svg.setAttribute('aria-label',`Sky trajectory relative to the reference observation, within ±${span.toFixed(1)}″: ${points.length} of ${result.points.length} frames measured`
      +(preds.length?`, ${preds.length} JPL-predicted positions${offPlot?' (path continues off-plot)':''}`:'')
      +(eph?.compared?`, median measured − predicted offset ${f(eph.offset_median_arcsec)}″`:'')
      +(m?`; net ${m.net_arcsec.toFixed(1)}″ toward ${fmtHead(m)} at ${fmtSpeed(m)}`:'')+'.');
    svgEl(svgEl(svg,'clipPath',{id:'track-plot-clip'}),'rect',{x:0,y:0,width:400,height:160});
    if(offPlot)svgEl(svg,'text',{x:392,y:12,fill:PRED,'font-size':10,'text-anchor':'end'},'JPL path continues off-plot');
    svgEl(svg,'path',{d:'M60 82H340 M200 12V152',stroke:'#3a3a3c'});
    // Trajectory path line connecting measured positions chronologically
    if(points.length>=2){
      const d=points.map((p,idx)=>`${idx?'L':'M'}${(ox+scale*p.east_arcsec).toFixed(1)} ${(oy-scale*p.north_arcsec).toFixed(1)}`).join(' ');
      svgEl(svg,'path',{d,fill:'none',stroke:result.target_kind==='asteroid'?'#eab354':'#68d391','stroke-width':1.8,'stroke-opacity':.75,pathLength:1,class:'trace'});
      const pFirst=points[0], pLast=points[points.length-1];
      const ax1=ox+scale*pFirst.east_arcsec, ay1=oy-scale*pFirst.north_arcsec;
      const ax2=ox+scale*pLast.east_arcsec, ay2=oy-scale*pLast.north_arcsec;
      const ang=Math.atan2(ay2-ay1,ax2-ax1);
      svgEl(svg,'path',{d:`M${ax2-7*Math.cos(ang-.45)} ${ay2-7*Math.sin(ang-.45)} L${ax2} ${ay2} L${ax2-7*Math.cos(ang+.45)} ${ay2-7*Math.sin(ang+.45)}`,fill:'none',stroke:'#f5f5f7','stroke-width':1.6});
    }
    svgEl(svg,'text',{x:10,y:170,fill:'#a1a1a6','font-size':10},eph?`East → / North ↑ · ±${span.toFixed(1)}″ · solid=measured · dashed=predicted (JPL)`:`East → / North ↑ · ±${span.toFixed(1)}″ · green=core · cyan=wing`);
    if(preds.length){
      const px=p=>ox+scale*p.predicted_east_arcsec, py=p=>oy-scale*p.predicted_north_arcsec;
      const svg=svgEl($("track-plot"),'g',{'clip-path':'url(#track-plot-clip)'});
      for(const p of points)if(p.predicted_east_arcsec!=null)svgEl(svg,'line',{x1:ox+scale*p.east_arcsec,y1:oy-scale*p.north_arcsec,x2:px(p),y2:py(p),stroke:p.within_tolerance===false?BAD:PRED,'stroke-width':1,'stroke-opacity':.8});
      const pd=preds.map((p,i)=>`${i?'L':'M'}${px(p).toFixed(1)} ${py(p).toFixed(1)}`).join(' ');
      // The dashed JPL path draws on through a solid mask, in step with the measured trace
      svgEl(svgEl(svg,'mask',{id:'jpl-draw',maskUnits:'userSpaceOnUse',x:0,y:0,width:400,height:180}),'path',{d:pd,fill:'none',stroke:'#fff','stroke-width':6,pathLength:1,class:'trace'});
      svgEl(svg,'path',{d:pd,fill:'none',stroke:PRED,'stroke-width':1.6,'stroke-dasharray':'5 4',mask:'url(#jpl-draw)'});
      for(const p of preds)svgEl(svg,'path',{d:`M${px(p)} ${py(p)-4}L${px(p)+4} ${py(p)}L${px(p)} ${py(p)+4}L${px(p)-4} ${py(p)}Z`,fill:'none',stroke:PRED,'stroke-width':1.3});
    }
    for(const p of points){
      const x=ox+scale*p.east_arcsec, y=oy-scale*p.north_arcsec;
      const col=p.fit_mode==='wing'?'#71d9f6':'#68d391';
      svgEl(svg,'ellipse',{cx:x,cy:y,rx:Math.max(2,scale*p.error_arcsec),ry:Math.max(2,scale*p.error_arcsec),fill:'none',stroke:col,'stroke-opacity':.28});
      const n=svgEl(svg,'circle',{cx:x,cy:y,r:3.4,fill:col,tabindex:0,role:'button','aria-label':p.timestamp});
      n.onclick=()=>setFrame(p.index);n.onkeydown=e=>{if(e.key==='Enter')setFrame(p.index);};
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent=`${p.timestamp} (${p.fit_mode||'core'}) ΔE=${p.east_arcsec.toFixed(2)}″ ΔN=${p.north_arcsec.toFixed(2)}″`+predTip(p);
      n.append(title);
    }
    renderChangeChart();
  }

  function kinds(){
    if(!result||result.session!==state.session?.id)return {};
    const k={};
    for(const p of result.points){
      if(p.accepted)k[p.fit_mode==='wing'?'wing':'measured']=true;
      else if(p.predicted)k.predicted=true;
      if(p.predicted)k.path=true;
    }
    return k;
  }

  function paint(ctx,frame,{side,left,top}){
    if(!result||result.session!==state.session?.id)return;
    const p=result.points.find(pt=>pt.index===frame.index);if(!p)return;
    const ordered=result.points.filter(v=>v.accepted).sort((a,b)=>a.mjd-b.mjd);
    ctx.save();ctx.beginPath();ctx.rect(left,top,side,side);ctx.clip();


    // Faded future/full measured trajectory
    if(ordered.length>=2){
      ctx.strokeStyle='rgba(113,217,246,.28)';ctx.setLineDash([4,4]);ctx.lineWidth=1.4;ctx.beginPath();
      ordered.forEach((pt,idx)=>{const px=left+pt.xy[0]*side,py=top+pt.xy[1]*side;idx?ctx.lineTo(px,py):ctx.moveTo(px,py);});
      ctx.stroke();ctx.setLineDash([]);
    }

    // JPL predicted track (dashed, purple) through every point with a prediction
    const predTrack=result.ephemeris?result.points.filter(v=>v.predicted).sort((a,b)=>a.mjd-b.mjd):[];
    if(predTrack.length){
      ctx.strokeStyle=PRED;ctx.setLineDash([7,4]);ctx.lineWidth=1.6;ctx.beginPath();
      predTrack.forEach((pt,idx)=>{const px=left+pt.predicted[0]*side,py=top+pt.predicted[1]*side;idx?ctx.lineTo(px,py):ctx.moveTo(px,py);});
      ctx.stroke();ctx.setLineDash([]);
    }

    // Active breadcrumb path up to current frame
    const past=ordered.filter(v=>v.mjd<=p.mjd);
    const activeColor=result.target_kind==='asteroid'?'#f0c58a':'#68d391';
    const markColor='#68d391';
    if(past.length>=1){
      ctx.strokeStyle=activeColor;ctx.lineWidth=2;ctx.beginPath();
      past.forEach((pt,idx)=>{const px=left+pt.xy[0]*side,py=top+pt.xy[1]*side;idx?ctx.lineTo(px,py):ctx.moveTo(px,py);});
      ctx.stroke();
      ctx.fillStyle=activeColor;
      for(const pt of past){
        ctx.beginPath();ctx.arc(left+pt.xy[0]*side,top+pt.xy[1]*side,3,0,Math.PI*2);ctx.fill();
      }
    }

    // Predicted path (violet): hollow rings over the measured trail, so both stay visible where they coincide
    const pred=predicted();
    if(pred.length){
      const at=pt=>[left+pt.predicted[0]*side,top+pt.predicted[1]*side];
      ctx.strokeStyle='#b9a3f5';ctx.fillStyle='#b9a3f5';ctx.lineWidth=2;ctx.setLineDash([5,5]);
      if(pred.length>=2){ctx.beginPath();pred.forEach((pt,i)=>{const [x,y]=at(pt);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
      ctx.setLineDash([]);
      for(const pt of pred){const [x,y]=at(pt);ctx.lineWidth=pt===p?2.4:1.6;ctx.beginPath();ctx.arc(x,y,pt===p?7:5,0,Math.PI*2);ctx.stroke();}
      const sel=pred.find(pt=>pt.index===selected);
      if(sel){const [x,y]=at(sel);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.stroke();}
    }
    syncCard();

    const xy=p.accepted?p.xy:p.predicted;
    if(xy){
      const x=left+xy[0]*side, y=top+xy[1]*side;
      const bad=p.accepted&&p.within_tolerance===false;
      const stroke=bad?BAD:p.accepted?(p.fit_mode==='wing'?'#71d9f6':markColor):'#b9a3f5';
      ctx.strokeStyle=stroke;ctx.lineWidth=1.8;ctx.setLineDash(p.accepted?[]:[4,4]);
      ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.stroke();
      // Box and name the Solar System object, so it is not mistaken for a neighbouring star
      if(result.ephemeris)ctx.strokeRect(x-21,y-21,42,42);
      ctx.setLineDash([]);
      if(result.ephemeris)markLabel(ctx,result.ephemeris.object||'Tracked object',x-21,y-27,stroke);

      // Draw pixel velocity arrow along ordered path
      const nextPt=ordered.find(v=>v.mjd>p.mjd) || past[past.length-1];
      const prevPt=past.length>=2?past[past.length-2]:past[0];
      if(nextPt && prevPt && nextPt!==prevPt){
        const dx=(nextPt.xy[0]-prevPt.xy[0])*side, dy=(nextPt.xy[1]-prevPt.xy[1])*side;
        const norm=Math.hypot(dx,dy);
        if(norm>1){
          const ux=dx/norm, uy=dy/norm, ex=x+ux*34, ey=y+uy*34, ang=Math.atan2(uy,ux);
          ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.beginPath();
          ctx.moveTo(x+ux*19,y+uy*19);ctx.lineTo(ex,ey);
          ctx.lineTo(ex-7*Math.cos(ang-.45),ey-7*Math.sin(ang-.45));
          ctx.moveTo(ex,ey);ctx.lineTo(ex-7*Math.cos(ang+.45),ey-7*Math.sin(ang+.45));
          ctx.stroke();
        }
      }

      const label=p.accepted?(p.fit_mode==='wing'?'Wing fit':'Measured'):'Predicted';
      markLabel(ctx,label,x+23,y-12,stroke);
      if(result.ephemeris&&p.predicted){
        const qx=left+p.predicted[0]*side,qy=top+p.predicted[1]*side;
        ctx.strokeStyle=PRED;ctx.lineWidth=2;ctx.beginPath();
        ctx.moveTo(qx,qy-7);ctx.lineTo(qx+7,qy);ctx.lineTo(qx,qy+7);ctx.lineTo(qx-7,qy);ctx.closePath();ctx.stroke();
        if(p.accepted&&p.offset_arcsec!=null)markLabel(ctx,`Δ ${p.offset_arcsec.toFixed(1)}″${bad?' · outside tolerance':''}`,x+23,y+4,stroke);
        markLabel(ctx,'JPL predicted',qx+10,y+36,PRED);  // below the object box
      }
    }else if(!p.accepted){
      // No measurement and no prediction to mark: say why on the image itself.
      const noteY=card&&!card.classList.contains('dot-top')?top+side-62:top+66;  // away from the info card
      markLabel(ctx,'Not measured in this frame',left+12,noteY,'#f0806e');
      markLabel(ctx,String(p.reason||''),left+12,noteY+16,'#f0806e');
    }
    ctx.restore();
  }

  // ---- Predicted path: hit test, info card ----
  const cur=()=>result&&result.session===state.session?.id?result:null;
  function predicted(){return cur()?result.points.filter(p=>p.predicted).sort((a,b)=>a.mjd-b.mjd):[];}
  function pick(px,py,{side,left,top}){
    let best=null,bd=Infinity;
    for(const p of predicted()){
      const d=Math.hypot(left+p.predicted[0]*side-px,top+p.predicted[1]*side-py);
      if(d>9)continue;
      const score=p.index===state.index?-1:d;
      if(score<bd){bd=score;best=p;}
    }
    return best;
  }
  // Exact inverse gnomonic (TAN) projection of the north-up, east-left image grid.
  function skyAt([x,y]){
    const {ra:ra0,dec:dec0,fov}=state.session.options,r=Math.PI/180;
    const w=fov/60*r,xi=-(x-.5)*w,eta=-(y-.5)*w,rho=Math.hypot(xi,eta),c=Math.atan(rho);
    const d0=dec0*r,dec=Math.asin(Math.cos(c)*Math.sin(d0)+(rho?eta*Math.sin(c)*Math.cos(d0)/rho:0));
    const ra=ra0*r+Math.atan2(xi*Math.sin(c),rho*Math.cos(d0)*Math.cos(c)-eta*Math.sin(d0)*Math.sin(c));
    return {ra:((ra/r)%360+360)%360,dec:dec/r};
  }
  let selected=null,card=null;
  function dropCard(){selected=null;if(card){card.remove();card=null;}}
  function closeCard(){dropCard();if(result)draw();}
  function syncCard(){
    if(card)card.querySelector('[data-go]').disabled=selected===state.index;
  }
  function openCard(point){
    if(!point||!cur())return;
    selected=point.index;
    const f=state.session.frames[point.index],list=predicted(),i=list.indexOf(point);
    if(!card){
      card=document.createElement('div');card.className='path-card';card.setAttribute('role','group');card.setAttribute('aria-label','Predicted position details');
      $('primary-pane').append(card);
    }
    // shortcut: corner chosen from the unzoomed dot position; recompute on pan/zoom if the card ever hides the dot
    card.classList.toggle('dot-right',point.predicted[0]>.5);card.classList.toggle('dot-top',point.predicted[1]<.5);
    const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
    const head=el('div','path-card-head'),close=el('button','path-card-close','\u00d7');
    head.append(el('h3',null,'Predicted position'),close);
    close.type='button';close.setAttribute('aria-label','Close');close.onclick=closeCard;
    const body=el('div','path-card-body');body.setAttribute('aria-live','polite');
    const row=(k,v)=>{const d=el('p');d.append(el('span','k',k),document.createTextNode(v));body.append(d);};
    body.append(el('p','path-card-time',`${dateText(f.timestamp)} ${timeText(f.timestamp)} UTC \u00b7 ${f.release}`));
    row('Based on: ',result.catalog?`Gaia DR3 position and proper motion \u00b7 ${result.catalog.name}`:(result.catalog_note||''));
    const s=skyAt(point.predicted);
    row('Predicted RA / Dec: ',`${s.ra.toFixed(5)}\u00b0, ${s.dec.toFixed(5)}\u00b0`);
    if(point.accepted){
      row('Status: ',point.fit_mode==='wing'?'Measured (wing fit)':'Measured');
      const as=Math.hypot(point.xy[0]-point.predicted[0],point.xy[1]-point.predicted[1])*state.session.options.fov*60;
      row('Measured \u2212 predicted: ',`${as.toFixed(2)}\u2033 (${(as/6.15).toFixed(2)} SPHEREx px)`);
      row('Position uncertainty: ',`\u00b1${point.error_arcsec.toFixed(2)}\u2033${Number.isFinite(point.snr)?` \u00b7 S/N ${point.snr.toFixed(1)}`:''}`);
    }else row('Status: ',`Not measured: ${point.reason}`);
    const acts=el('div','path-card-actions');
    const btn=(label,fn,attr)=>{const b=el('button','btn-outline btn-compact',label);b.type='button';b.onclick=fn;if(attr)b.setAttribute(attr,'');acts.append(b);return b;};
    btn('Earlier',()=>openCard(list[i-1])).disabled=i<=0;
    btn('Later',()=>openCard(list[i+1])).disabled=i>=list.length-1;
    btn('Go to this frame',()=>setFrame(point.index),'data-go');
    card.replaceChildren(head,body,acts);
    syncCard();draw();
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&card)closeCard();});
  $('track-path').onclick=()=>{
    const l=predicted();if(!l.length)return;
    const t=(result.points.find(p=>p.index===state.index)||{}).mjd??l[0].mjd;
    openCard(l.reduce((a,b)=>Math.abs(b.mjd-t)<Math.abs(a.mjd-t)?b:a));
  };
  $("track-export").onclick=()=>result&&download('star-motion-track.json',JSON.stringify(result,null,2),'application/json');
  function stopSpace(){clearInterval(timer);timer=null;$("star-space-play").textContent='▶ Play motion';}
  $("track-3d").onclick=()=>{if(!result?.catalog?.xyz)return;const c=result.catalog;$("star-space-title").textContent=c.name;$("star-space-year").value=Math.round(c.epoch);$("star-space-play").disabled=!c.velocity;$("star-space-year").disabled=!c.velocity;$("star-space-note").textContent=c.velocity?'Gaia catalog trajectory: straight-line motion relative to the Solar System barycenter. This path uses catalog distance, proper motion and radial velocity, independently of the image drift. No orbital acceleration or full uncertainty propagation. The background is decorative.':'Gaia distance locates this source in space. Radial velocity is unavailable, so a complete 3D trajectory cannot be shown. The background is decorative.';yaw=-Math.atan2(c.xyz[1],c.xyz[0]);pitch=0;zoom=1;$("star-space").showModal();requestAnimationFrame(spaceDraw);};
  $("star-space-close").onclick=()=>$("star-space").close();$("star-space").addEventListener('close',stopSpace);
  $("star-space-year").oninput=spaceDraw;
  $("star-space-reset").onclick=()=>{stopSpace();yaw=-Math.atan2(result.catalog.xyz[1],result.catalog.xyz[0]);pitch=0;zoom=1;$("star-space-year").value=Math.round(result.catalog.epoch);spaceDraw();};
  $("star-space-play").onclick=()=>{if(timer){stopSpace();return;}$("star-space-play").textContent='Ⅱ Pause';timer=setInterval(()=>{const slider=$("star-space-year");slider.value=+slider.value>=2516?1516:+slider.value+2;spaceDraw();},40);};
  function spaceDraw(){
    if(!$("star-space").open||!result?.catalog?.xyz)return;
    const c=result.catalog,year=+$("star-space-year").value,dt=year-c.epoch;
    $("star-space-year-label").textContent=year;
    const at=t=>c.xyz.map((v,i)=>v+(c.velocity?.[i]||0)*(t-c.epoch));
    const current=at(year),canvas=$("star-space-canvas"),box=canvas.getBoundingClientRect(),w=box.width,h=box.height,dpr=window.devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
    const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#040b19');bg.addColorStop(.5,'#111226');bg.addColorStop(1,'#030913');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(const [x,y,color] of [[.25,.65,'rgba(36,86,131,.16)'],[.75,.35,'rgba(125,72,116,.13)']]){const g=ctx.createRadialGradient(w*x,h*y,0,w*x,h*y,w*.55);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
    const center=c.xyz.map(v=>v/2),radius=Math.max(Math.hypot(...c.xyz),Math.hypot(...at(1516)),Math.hypot(...at(2516)),.01),scale=Math.min(w,h)*.65/radius*zoom;
    // Rotate the physical Cartesian geometry; orthographic projection keeps the scale uniform.
    const project=p=>{const [x,y,z]=p.map((v,i)=>v-center[i]);const a=Math.cos(yaw)*x-Math.sin(yaw)*y,b=Math.sin(yaw)*x+Math.cos(yaw)*y;return [w/2+a*scale,h/2-(Math.cos(pitch)*z-Math.sin(pitch)*b)*scale,Math.sin(pitch)*z+Math.cos(pitch)*b];};
    if(c.velocity){ctx.strokeStyle='#6cb8ff';ctx.lineWidth=2;ctx.beginPath();for(let t=1516;t<=2516;t+=10){const p=project(at(t));t===1516?ctx.moveTo(...p.slice(0,2)):ctx.lineTo(...p.slice(0,2));}ctx.stroke();for(const t of [1516,2516]){const p=project(at(t));ctx.fillStyle='#7d9eb9';ctx.font='11px Segoe UI';ctx.fillText(String(t),p[0]+8,p[1]+22);}}
    const sun=project([0,0,0]),star=project(current);ctx.strokeStyle='rgba(234,179,84,.25)';ctx.setLineDash([3,7]);ctx.beginPath();ctx.moveTo(sun[0],sun[1]);ctx.lineTo(star[0],star[1]);ctx.stroke();ctx.setLineDash([]);
    for(const body of [{p:sun,r:21,color:'#f5bb65',label:'Solar System · origin'},{p:star,r:16,color:'#93d1ff',label:'Tracked star'}].sort((a,b)=>a.p[2]-b.p[2])){
      const [x,y]=body.p,r=body.r;let g=ctx.createRadialGradient(x,y,0,x,y,r*5);g.addColorStop(0,body.color+'88');g.addColorStop(.2,body.color+'22');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x-r*5,y-r*5,r*10,r*10);
      g=ctx.createRadialGradient(x-r*.35,y-r*.4,1,x,y,r);g.addColorStop(0,'#fff9e9');g.addColorStop(.45,body.color);g.addColorStop(1,'#172337');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e9e5dc';ctx.font='13px Segoe UI';ctx.fillText(body.label,x+r+12,y+4);
    }
    $("star-space-distance").textContent=`${Math.hypot(...current).toFixed(3)} pc from Solar System · ${year}`;
  }
  let drag=null;const canvas=$("star-space-canvas");canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY,yaw,pitch];canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(drag){yaw=drag[2]+(e.clientX-drag[0])*.008;pitch=Math.max(-1.5,Math.min(1.5,drag[3]+(e.clientY-drag[1])*.008));spaceDraw();}};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.3,Math.min(8,zoom*Math.exp(-e.deltaY*.001)));spaceDraw();},{passive:false});new ResizeObserver(spaceDraw).observe(canvas);
  return {paint,kinds,pick,open:openCard};
})();

