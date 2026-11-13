"use strict";

function startViewer(fields, detectorViews) {
  const element = (id) => document.getElementById(id);
  const text = (id, value) => { element(id).textContent = value; };
  const link = (id, href) => { element(id).href = href; };
  const shortDate = new Intl.DateTimeFormat("en", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
  const shortTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  });
  const image = element("sky-image");
  const marker = element("marker");
  const play = element("play");
  const speed = element("speed");
  const timeline = element("timeline");
  const markerToggle = element("marker-toggle");
  const fullToggle = element("full-view");
  const alignedToggle = element("aligned-view");
  const colorToggle = element("color-toggle");
  const bands = [
    ["0.75–1.09", "#a986ed"], ["1.10–1.62", "#72a9ec"], ["1.63–2.41", "#77d8a7"],
    ["2.42–3.82", "#d2d269"], ["3.83–4.41", "#f2bc6d"], ["4.42–5.00", "#f08071"],
  ];
  let selectedField = 0;
  let selectedFrame = 0;
  let fullMode = true;
  let showColor = true;
  let preferredDetector = fields[0].frames[0].detector;
  let showMarker = true;
  let timer = null;
  let thumbnails = [];

  function getFullView(frame, detector) {
    const available = detectorViews[frame.id] ?? [];
    return available.find((view) => view.detector === detector)
      ?? available.find((view) => view.detector === frame.detector)
      ?? available[0];
  }

  function imageButton(className, png, label, caption) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    const preview = document.createElement("img");
    preview.alt = "";
    preview.src = png;
    const copy = document.createElement("span");
    const title = document.createElement(className === "field" ? "strong" : "span");
    const subtitle = document.createElement("small");
    title.textContent = label;
    subtitle.textContent = caption;
    copy.append(title, subtitle);
    button.append(preview, copy);
    return button;
  }

  function updateMarker(position, isFull) {
    markerToggle.hidden = !position;
    markerToggle.setAttribute("aria-pressed", String(showMarker));
    marker.classList.toggle("full-marker", isFull);
    marker.hidden = !showMarker || !position;
    if (position) {
      marker.style.left = `${100 * position[0]}%`;
      marker.style.top = `${100 * position[1]}%`;
    }
  }

  const bandButtons = bands.map(([range, hue], index) => {
    const detector = index + 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "band";
    button.style.setProperty("--band", hue);
    const name = document.createElement("strong");
    name.textContent = `D${detector}`;
    const label = document.createElement("span");
    label.textContent = range;
    button.append(name, label);
    button.setAttribute("aria-label", `Detector ${detector}, ${range} micrometers`);
    button.addEventListener("click", () => {
      preferredDetector = detector;
      chooseFrame(selectedFrame);
    });
    return button;
  });
  element("bands").replaceChildren(...bandButtons);

  function renderImageMode(field, frame, full, dateLabel, timeLabel) {
    const display = full?.jpeg ?? frame.png;
    const isFull = Boolean(full);
    const detector = full?.detector ?? frame.detector;
    const available = detectorViews[frame.id] ?? [];
    image.alt = `${isFull ? "Full detector" : "Aligned"} SPHEREx image, D${detector}, ${dateLabel} at ${timeLabel} UTC`;
    image.src = display;
    image.classList.toggle("full-detector", isFull);
    image.classList.toggle("grayscale", isFull && !showColor);
    updateMarker(isFull ? full.marker : frame.marker, isFull);

    element("sky-north").hidden = isFull;
    element("band-toolbar").hidden = !fullMode;
    fullToggle.setAttribute("aria-pressed", String(fullMode));
    alignedToggle.setAttribute("aria-pressed", String(!fullMode));
    colorToggle.setAttribute("aria-pressed", String(showColor));
    colorToggle.textContent = showColor ? "Band colors" : "Grayscale";
    bandButtons.forEach((button, index) => {
      const band = index + 1;
      button.disabled = !available.some((view) => view.detector === band);
      button.setAttribute("aria-pressed", String(isFull && detector === band));
      button.title = button.disabled ? "No full image for this date and detector" : "";
    });
    let note = "Same sky position on every date. Use Play to flip between observations.";
    if (fullMode) {
      if (!full) {
        note = "A full detector image is unavailable for this date. Showing the aligned crop.";
      } else if (!full.containsFieldCenter) {
        note = "This detector shows neighboring sky from the same exposure. The selected field is outside this image.";
      } else {
        note = "Full detector view. Pointing can change between dates. Use Aligned crop to compare movement.";
      }
    }
    if (full && full.detector !== preferredDetector) {
      note = `D${preferredDetector} is unavailable on this date. Showing D${full.detector}. ${note}`;
    }
    text("view-note", note);
    text("sky-width", isFull ? "2040 × 2040 · ~3.5° FIELD" : `${field.widthArcmin}′ FIELD`);
    text("observation-id", `${frame.id} / D${detector}`);
    text("observation-sensor", `D${detector} / ${frame.release}`);
    text("wavelength-label", isFull ? "Infrared range" : "Infrared at reference point");
    const cropWavelength = frame.wavelength === null ? "See FITS data" : `≈ ${frame.wavelength.toFixed(3)} µm`;
    text("observation-wavelength", isFull ? `${full.range} µm` : cropWavelength);
    element("flags-row").hidden = isFull;
    element("fits-download").hidden = isFull;
    text("observation-flags", frame.flags === 0 ? "0 · No flags" : `${frame.flags.toLocaleString("en-US")} · Flagged`);
    text("verification-note", isFull
      ? "The original FITS header matches the archive observation, capture time, and detector. The full 2040 × 2040 image is displayed with an assigned band color and its own brightness scale."
      : "The archive record matches the FITS crop’s observation ID, capture time, and detector. The crop contains image and pixel quality data.");
    element("observation-hash").hidden = isFull;
    text("observation-hash", `SHA-256 · ${frame.sha256}`);
    text("display-image-label", isFull ? "Open full-resolution image" : "Open crop PNG");
    link("fits-download", frame.fits);
    link("display-image", display);
    link("archive-file", full?.source ?? frame.source);
  }

  function renderFrame(index) {
    const field = fields[selectedField];
    const count = field.frames.length;
    selectedFrame = (index + count) % count;
    const frame = field.frames[selectedFrame];
    const date = new Date(frame.timestamp);
    const dateLabel = shortDate.format(date);
    const timeLabel = shortTime.format(date);
    const full = fullMode ? getFullView(frame, preferredDetector) : undefined;
    renderImageMode(field, frame, full, dateLabel, timeLabel);
    timeline.value = selectedFrame;
    timeline.setAttribute("aria-valuetext", `Frame ${selectedFrame + 1} of ${count}, ${dateLabel} ${timeLabel} UTC`);
    text("sky-frame-number", `FRAME ${String(selectedFrame + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`);
    text("observation-time", `${dateLabel} · ${timeLabel}`);
    thumbnails.forEach((button, i) => {
      const other = field.frames[i];
      const view = fullMode ? getFullView(other, preferredDetector) : undefined;
      const src = view?.jpeg ?? other.png;
      const preview = button.querySelector("img");
      if (preview.getAttribute("src") !== src) preview.src = src;
      button.setAttribute("aria-current", String(i === selectedFrame));
    });
  }

  function stopPlayback() {
    window.clearInterval(timer);
    timer = null;
    play.setAttribute("aria-pressed", "false");
    play.innerHTML = '<span aria-hidden="true">▶</span> Play';
  }

  function startPlayback() {
    timer = window.setInterval(() => renderFrame(selectedFrame + 1), Number(speed.value));
    play.setAttribute("aria-pressed", "true");
    play.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  }

  function chooseFrame(index) {
    stopPlayback();
    renderFrame(index);
  }

  function selectField(index) {
    stopPlayback();
    selectedField = index;
    const field = fields[index];
    preferredDetector = field.frames[0].detector;
    fieldButtons.forEach((button, i) => button.setAttribute("aria-current", String(i === index)));
    text("field-name", field.name);
    text("field-category", field.category.toUpperCase());
    text("field-description", field.description);
    text("observation-coordinates", `RA ${field.ra.toFixed(4)}° · Dec ${field.dec.toFixed(4)}°`);
    link("archive-search", field.query);
    timeline.max = field.frames.length - 1;
    thumbnails = field.frames.map((frame, i) => {
      const date = new Date(frame.timestamp);
      const button = imageButton("thumb", frame.png, shortDate.format(date), shortTime.format(date) + " UTC");
      button.addEventListener("click", () => chooseFrame(i));
      return button;
    });
    element("filmstrip").replaceChildren(...thumbnails);
    renderFrame(0);
  }

  const fieldButtons = fields.map((field, i) => {
    const first = field.frames[0];
    const preview = getFullView(first, first.detector)?.jpeg ?? first.png;
    const button = imageButton("field", preview, field.name, `${field.frames.length} dates`);
    button.addEventListener("click", () => selectField(i));
    return button;
  });
  element("fields").replaceChildren(...fieldButtons);
  text("field-count", String(fields.length).padStart(2, "0"));
  const fullCount = Object.values(detectorViews).reduce((total, images) => total + images.length, 0);
  text("inventory", `${String(fields.length).padStart(2, "0")} FIELDS  /  ${fullCount} FULL DETECTOR IMAGES`);
  element("prev").addEventListener("click", () => chooseFrame(selectedFrame - 1));
  element("next").addEventListener("click", () => chooseFrame(selectedFrame + 1));
  timeline.addEventListener("input", () => chooseFrame(Number(timeline.value)));
  play.addEventListener("click", () => timer === null ? startPlayback() : stopPlayback());
  speed.addEventListener("change", () => {
    if (timer === null) return;
    stopPlayback();
    startPlayback();
  });
  markerToggle.addEventListener("click", () => {
    showMarker = !showMarker;
    renderFrame(selectedFrame);
  });
  fullToggle.addEventListener("click", () => {
    fullMode = true;
    chooseFrame(selectedFrame);
  });
  alignedToggle.addEventListener("click", () => {
    fullMode = false;
    chooseFrame(selectedFrame);
  });
  colorToggle.addEventListener("click", () => {
    showColor = !showColor;
    renderFrame(selectedFrame);
  });
  selectField(0);
  element("workspace").hidden = false;
}

const library = window.SPHEREX_COLLECTION;
if (library?.fields.length) {
  startViewer(library.fields, window.SPHEREX_DETECTORS ?? {});
} else {
  document.getElementById("load-error").hidden = false;
}
