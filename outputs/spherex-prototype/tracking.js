"use strict";
const StarTracker = (() => {
  let result=null, choice=null, anchor2=null, awaitingAnchor2=false, version=0, timer=null, yaw=.6, pitch=.3, zoom=1;
  const setText=(id,val)=>{const el=$(id);if(el)el.textContent=val;};
  const compass=deg=>['N','NE','E','SE','S','SW','W','NW'][Math.round(((deg%360)+360)%360/45)%8];

  function resetAnchorBtn(){
    awaitingAnchor2=false;
    const btn=$("track-anchor");
    if(btn){btn.setAttribute("aria-pressed","false");btn.disabled=!choice;}
  }

  function clear() {
    version++;result=null;choice=null;anchor2=null;
    resetAnchorBtn();
    $("track-result").hidden=true;
    $("track-3d").disabled=true;
    $("track-star").disabled=false;
    $("track-status").textContent="Click a star or asteroid, then track its path.";
    setText("track-kind-pill","Ready");
    setText("kpi-speed","—");setText("kpi-heading","—");setText("kpi-change","—");setText("kpi-points","—");
    draw();
  }

  window.addEventListener("sky-session-ready",clear);
  window.addEventListener("sky-point-picked",event=>{
    if(awaitingAnchor2 && choice && event.detail.frame !== choice.frame){
      anchor2=event.detail;
      resetAnchorBtn();
      $("track-status").textContent=`Anchor 2 locked (frame ${anchor2.frame+1}). Ready to track moving path.`;
      return;
    }
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
    if(!choice){$("track-status").textContent="Click a star or moving object in the image first.";return;}
    const token=++version;$("track-star").disabled=true;
    try{
      const body={session:state.session.id,frame:choice.frame,x:choice.x,y:choice.y};
      if(anchor2)body.anchor2={frame:anchor2.frame,x:anchor2.x,y:anchor2.y};
      const job=await api('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      while(token===version){
        const status=await api('/api/jobs/'+job.id);if(token!==version)return;
        $("track-status").textContent=status.stage;
        if(status.status==='failed')throw new Error(status.stage);
        if(status.status==='complete'){result=status.result;render();draw();break;}
        await new Promise(resolve=>setTimeout(resolve,600));
      }
    }catch(e){if(token===version)$("track-status").textContent=e.message;}
    finally{if(token===version)$("track-star").disabled=false;}
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
      svgEl(svg,'text',{x:200,y:78,fill:'#8a94a6','font-size':11,'text-anchor':'middle'},'Need 2+ distinct epochs for speed & change curve');
      return;
    }
    const useHr=result.motion?.preferred_unit==='hr';
    const speeds=segs.map(s=>useHr?s.speed_arcsec_per_hr:s.speed_arcsec_per_yr);
    const maxCum=Math.max(1e-3,...segs.map(s=>s.cumulative_arcsec));
    const maxSpd=Math.max(1e-3,...speeds);
    const t0=segs[0].mjd_start, span=Math.max(1e-3,segs[segs.length-1].mjd_end-t0);
    const x0=44,x1=360,yTop=18,yBot=118;
    svgEl(svg,'path',{d:`M${x0} ${yBot}H${x1} M${x0} ${yTop}V${yBot}`,stroke:'#384150','stroke-width':1});
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
  }

  function render(){
    const points=result.points.filter(p=>p.accepted).sort((a,b)=>a.mjd-b.mjd);
    const c=result.catalog, m=result.motion, ch=result.change;
    const kindLabel=result.target_kind==='asteroid'?'Asteroid':(c?'Gaia star':'Moving source');
    $("track-result").hidden=false;
    $("track-3d").disabled=!c?.xyz;
    setText("track-kind-pill",kindLabel);
    const wingCount=points.filter(p=>p.fit_mode==='wing').length;
    const fitNote=wingCount?` (${wingCount} wing-fit)`:'';
    $("track-status").textContent=`${points.length} / ${result.points.length} measured${fitNote}. ${c?c.name:result.catalog_note}`;

    if(m){
      const useHr=m.preferred_unit==='hr';
      setText("kpi-speed",useHr?`${m.speed_arcsec_per_hr.toFixed(1)} ″/hr`:`${m.speed_arcsec_per_year.toFixed(2)} ″/yr`);
      setText("kpi-heading",`${m.heading_deg.toFixed(0)}° ${compass(m.heading_deg)}`);
    }else{
      setText("kpi-speed","—");setText("kpi-heading","—");
    }
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

    const svg=$("track-plot");svg.replaceChildren();if(!points.length)return;
    const span=Math.max(1,...points.map(p=>Math.max(Math.abs(p.east_arcsec),Math.abs(p.north_arcsec))+p.error_arcsec));
    const scale=64/span, ox=200, oy=82;
    svgEl(svg,'path',{d:'M60 82H340 M200 12V152',stroke:'#384150'});
    // Trajectory path line connecting measured positions chronologically
    if(points.length>=2){
      const d=points.map((p,idx)=>`${idx?'L':'M'}${(ox+scale*p.east_arcsec).toFixed(1)} ${(oy-scale*p.north_arcsec).toFixed(1)}`).join(' ');
      svgEl(svg,'path',{d,fill:'none',stroke:result.target_kind==='asteroid'?'#eab354':'#68d391','stroke-width':1.8,'stroke-opacity':.75});
      const pFirst=points[0], pLast=points[points.length-1];
      const ax1=ox+scale*pFirst.east_arcsec, ay1=oy-scale*pFirst.north_arcsec;
      const ax2=ox+scale*pLast.east_arcsec, ay2=oy-scale*pLast.north_arcsec;
      const ang=Math.atan2(ay2-ay1,ax2-ax1);
      svgEl(svg,'path',{d:`M${ax2-7*Math.cos(ang-.45)} ${ay2-7*Math.sin(ang-.45)} L${ax2} ${ay2} L${ax2-7*Math.cos(ang+.45)} ${ay2-7*Math.sin(ang+.45)}`,fill:'none',stroke:'#f5f7fa','stroke-width':1.6});
    }
    svgEl(svg,'text',{x:10,y:170,fill:'#9fb0c4','font-size':10},`East → / North ↑ · ±${span.toFixed(1)}″ · green=core · cyan=wing`);
    for(const p of points){
      const x=ox+scale*p.east_arcsec, y=oy-scale*p.north_arcsec;
      const col=p.fit_mode==='wing'?'#71d9f6':'#68d391';
      svgEl(svg,'ellipse',{cx:x,cy:y,rx:Math.max(2,scale*p.error_arcsec),ry:Math.max(2,scale*p.error_arcsec),fill:'none',stroke:col,'stroke-opacity':.28});
      const n=svgEl(svg,'circle',{cx:x,cy:y,r:3.4,fill:col,tabindex:0,role:'button','aria-label':p.timestamp});
      n.onclick=()=>setFrame(p.index);n.onkeydown=e=>{if(e.key==='Enter')setFrame(p.index);};
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent=`${p.timestamp} (${p.fit_mode||'core'}) ΔE=${p.east_arcsec.toFixed(2)}″ ΔN=${p.north_arcsec.toFixed(2)}″`;
      n.append(title);
    }
    renderChangeChart();
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

    // Active breadcrumb path up to current frame
    const past=ordered.filter(v=>v.mjd<=p.mjd);
    const activeColor=result.target_kind==='asteroid'?'#f0c58a':'#68d391';
    if(past.length>=1){
      ctx.strokeStyle=activeColor;ctx.lineWidth=2;ctx.beginPath();
      past.forEach((pt,idx)=>{const px=left+pt.xy[0]*side,py=top+pt.xy[1]*side;idx?ctx.lineTo(px,py):ctx.moveTo(px,py);});
      ctx.stroke();
      ctx.fillStyle=activeColor;
      for(const pt of past){
        ctx.beginPath();ctx.arc(left+pt.xy[0]*side,top+pt.xy[1]*side,3,0,Math.PI*2);ctx.fill();
      }
    }

    const xy=p.accepted?p.xy:p.predicted;
    if(xy){
      const x=left+xy[0]*side, y=top+xy[1]*side;
      const stroke=p.accepted?(p.fit_mode==='wing'?'#71d9f6':activeColor):'#eab354';
      ctx.strokeStyle=stroke;ctx.lineWidth=1.8;ctx.setLineDash(p.accepted?[]:[4,4]);
      ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);

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

      ctx.font='600 12px Segoe UI';ctx.fillStyle=stroke;
      const label=p.accepted?(p.fit_mode==='wing'?'Wing fit':'Measured'):'Predicted';
      ctx.fillText(label,x+23,y-12);
    }
    ctx.restore();
  }
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
  return {paint};
})();

