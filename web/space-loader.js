/* Space-themed loading indicators shared by the main shell and the SPHEREx lab iframe.
 *
 *  SpaceLoader.begin(label)        -> handle {set(label, fraction?), end()}
 *  SpaceLoader.track(label, promise)
 *  SpaceLoader.cover(host, {eyebrow, title, detail}) -> {update({...}), done()}
 *  SpaceLoader.orbit()             -> orbit animation markup
 *
 * Every fetch() whose URL matches a rule below is announced automatically in the
 * "downlink" capsule and the beam along the top edge, so data pulls are obvious.
 */
(() => {
  "use strict";
  if (window.SpaceLoader) return;

  const SHOW_DELAY = 140;   // quick requests never flash the HUD
  const MIN_VISIBLE = 650;  // once shown, stay long enough to be read
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // URL -> friendly label. null means "do not announce" (the caller tracks it explicitly).
  const rules = [
    [/\/observation-lab\/api\/jobs(\/|$)/, null],
    [/\/observation-lab\/api\/spectrum/, null],
    [/\/observation-lab\/api\/track/, null],
    [/\/observation-lab\/api\/pixel/, "Reading native pixel"],
    [/\/observation-lab\/api\/identify/, "Identifying source in catalogs"],
    [/\/observation-lab\/api\/(library|fields|updates)/, "Loading observation library"],
    [/\/observation-lab\/api\//, "Contacting SPHEREx service"],
    [/\/observation-lab\/catalogs\//, "Loading star catalog"],
    [/\/api\/search/, "Searching IRSA archive"],
    [/\/api\/archive\/open/, "Opening IRSA exposure"],
    [/\/api\/archive/, "Browsing IRSA archive"],
    [/\/api\/jobs\/[^/?]+\/spectrum/, "Pulling aperture spectrum"],
    [/\/api\/jobs\/[^/?]+\/catalog/, "Querying Gaia / WISE overlay"],
    [/\/api\/jobs\/[^/?]+\/satellite-view/, "Downloading detector frame"],
    [/\/api\/jobs\/[^/?]+\/lightcurve/, "Measuring light curve"],
    [/\/api\/jobs\/[^/?]+\/(motion|predicted)/, "Measuring motion"],
    [/\/api\/jobs\/[^/?]+\/computed/, "Computing quicklook"],
    [/\/api\/jobs\/[^/?]+\/groups/, "Grouping exposures"],
    [/\/api\/jobs\/[^/?]+\/export/, "Preparing export"],
    [/\/api\/jobs\/[^/?]+\/(pause|resume)/, null],
    [/\/api\/jobs\/[^/?]+(\?|$)/, "Syncing archive cutouts"],
    [/\/api\/laya/, null],
    [/\/api\/space/, "Querying Gaia DR3"],
    [/\/api\/solar/, "Computing planetary positions"],
    [/\/api\/resolve/, "Resolving target name"],
    [/\/api\/context-sky/, "Loading catalog sky"],
    [/\/api\/(journey|companions)/, "Plotting journey context"],
    [/\/api\/target-systems/, "Loading exoplanet systems"],
    [/\/api\//, "Contacting data service"],
    [/\/assets\/.+\.(glb|jpg|png|json)/, "Streaming planet assets"],
  ];
  const labelFor = url => {
    for (const [pattern, label] of rules) if (pattern.test(url)) return label;
    return null;
  };

  // ---------- HUD ----------
  const tasks = new Map();
  let nextId = 1, hud, beam, textEl, countEl, meterEl, shownAt = 0, showTimer = 0, hideTimer = 0;

  function ensureHud() {
    if (hud || !document.body) return;
    beam = document.createElement("div");
    beam.className = "sl-beam";
    beam.setAttribute("aria-hidden", "true");
    hud = document.createElement("div");
    hud.className = "sl-hud";
    hud.setAttribute("role", "status");
    hud.setAttribute("aria-live", "polite");
    hud.innerHTML =
      '<span class="sl-radar" aria-hidden="true"><i></i><b></b></span>' +
      '<span class="sl-copy"><small>DOWNLINK ACTIVE</small><span class="sl-text"></span></span>' +
      '<span class="sl-count" hidden></span>' +
      '<span class="sl-meter" aria-hidden="true"><i></i></span>';
    textEl = hud.querySelector(".sl-text");
    countEl = hud.querySelector(".sl-count");
    meterEl = hud.querySelector(".sl-meter");
    document.body.append(beam, hud);
  }

  function render() {
    ensureHud();
    if (!hud) return;
    const list = [...tasks.values()];
    if (!list.length) {
      clearTimeout(showTimer); showTimer = 0;
      if (!hud.classList.contains("sl-on")) return;
      const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt));
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (tasks.size) return;
        hud.classList.remove("sl-on"); beam.classList.remove("sl-on");
        document.documentElement.classList.remove("sl-pulling");
      }, wait);
      return;
    }
    clearTimeout(hideTimer);
    const top = list[list.length - 1];
    textEl.textContent = top.label;
    countEl.hidden = list.length < 2;
    countEl.textContent = "+" + (list.length - 1);
    const fraction = top.fraction;
    meterEl.classList.toggle("sl-determinate", fraction != null);
    meterEl.firstChild.style.width = fraction != null ? (Math.max(.03, Math.min(1, fraction)) * 100).toFixed(1) + "%" : "";
    if (hud.classList.contains("sl-on") || showTimer) return;
    showTimer = setTimeout(() => {
      showTimer = 0;
      if (!tasks.size) return;
      shownAt = performance.now();
      // Sit just below the page's own header so it never hides navigation.
      const header = document.querySelector("body > header, .app-bar");
      const bottom = header ? header.getBoundingClientRect().bottom : 0;
      hud.style.setProperty("--sl-top", Math.max(12, Math.round(bottom + 10)) + "px");
      hud.classList.add("sl-on"); beam.classList.add("sl-on");
      document.documentElement.classList.add("sl-pulling");
    }, SHOW_DELAY);
  }

  function begin(label) {
    const id = nextId++;
    tasks.set(id, {label, fraction: null});
    render();
    return {
      set(next, fraction) {
        const task = tasks.get(id); if (!task) return;
        if (next) task.label = next;
        if (fraction === undefined && next) {
          const m = /(\d+)\s*(?:of|\/)\s*(\d+)/.exec(next);
          fraction = m && +m[2] > 0 ? +m[1] / +m[2] : null;
        }
        task.fraction = fraction ?? null;
        // keep the most recently updated task on top
        tasks.delete(id); tasks.set(id, task);
        render();
      },
      end() { if (tasks.delete(id)) render(); },
    };
  }

  function track(label, promise) {
    const h = begin(label);
    return Promise.resolve(promise).finally(() => h.end());
  }

  // ---------- fetch instrumentation ----------
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url = "";
    try { url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; } catch {}
    const label = labelFor(url || "");
    if (!label) return nativeFetch(input, init);
    const h = begin(label);
    // Release when the body has been read too, not merely when headers arrive.
    return nativeFetch(input, init).then(response => {
      const done = () => h.end();
      for (const method of ["json", "text", "blob", "arrayBuffer"]) {
        const original = response[method].bind(response);
        response[method] = () => original().finally(done);
      }
      // Streaming readers (three.js loaders) use .body directly: finish when the stream does.
      const bodyGetter = Object.getOwnPropertyDescriptor(Response.prototype, "body")?.get;
      if (bodyGetter) {
        let piped;
        Object.defineProperty(response, "body", {configurable: true, get() {
          if (piped === undefined) {
            const raw = bodyGetter.call(response);
            piped = raw ? raw.pipeThrough(new TransformStream({flush: done})) : raw;
            if (!raw) done();
          }
          return piped;
        }});
      }
      setTimeout(done, 30000); // safety net if the body is never read
      return response;
    }, error => { h.end(); throw error; });
  };

  // ---------- orbit animation + covers ----------
  function orbit() {
    return '<div class="sl-orbit" aria-hidden="true">' +
      '<span class="sl-ring sl-ring-a"><i class="sl-moon"></i></span>' +
      '<span class="sl-ring sl-ring-b"><i class="sl-sat"></i></span>' +
      '<span class="sl-ring sl-ring-c"><i class="sl-moon sl-moon-c"></i></span>' +
      '<span class="sl-planet"></span>' +
      '<span class="sl-ping"></span>' +
      '</div>';
  }

  function cover(host, opts = {}) {
    if (!host) return {update() {}, done() {}};
    let el = host.querySelector(":scope > .sl-cover");
    if (!el) {
      if (getComputedStyle(host).position === "static") host.classList.add("sl-host");
      el = document.createElement("div");
      el.className = "sl-cover";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML = '<div class="sl-stars" aria-hidden="true"></div>' + orbit() +
        '<p class="sl-eyebrow"></p><h3 class="sl-title"></h3><p class="sl-detail"></p>' +
        '<div class="sl-meter sl-meter-wide" aria-hidden="true"><i></i></div>';
      host.append(el);
    }
    clearTimeout(el._hide);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("sl-on"));
    const handle = {
      update({eyebrow, title, detail, progress} = {}) {
        if (eyebrow != null) el.querySelector(".sl-eyebrow").textContent = eyebrow;
        if (title != null) el.querySelector(".sl-title").textContent = title;
        if (detail != null) el.querySelector(".sl-detail").textContent = detail;
        const meter = el.querySelector(".sl-meter");
        meter.classList.toggle("sl-determinate", progress != null);
        meter.firstChild.style.width = progress != null ? (Math.max(.03, Math.min(1, progress)) * 100).toFixed(1) + "%" : "";
      },
      done() {
        el.classList.remove("sl-on");
        el._hide = setTimeout(() => { el.hidden = true; }, reduced() ? 0 : 450);
      },
    };
    handle.update({eyebrow: opts.eyebrow || "ESTABLISHING DOWNLINK", title: opts.title || "Loading", detail: opts.detail || "", progress: opts.progress});
    return handle;
  }

  function upgradeOrbits(root = document) {
    root.querySelectorAll(".loading-orbit:not(.sl-upgraded)").forEach(e => {
      e.classList.add("sl-upgraded");
      e.innerHTML = orbit();
    });
  }

  window.SpaceLoader = {begin, track, cover, orbit, labelFor, nativeFetch};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { ensureHud(); upgradeOrbits(); });
  else { ensureHud(); upgradeOrbits(); }
})();
