// Custom select: the native <select> stays in the DOM as the source of truth; this draws a
// trigger button plus a listbox popover (WAI-ARIA select-only combobox) on top of it.
(() => {
  const CHEVRON = '<svg class="ui-select-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  const SEARCH_MIN = 11, RENDER_MAX = 200, GAP = 4, PAD = 8;
  const proto = HTMLSelectElement.prototype;
  let uid = 0;

  function labelFor(select) {
    // Returns an element whose text names the select, without the select's own option text.
    const forLabel = select.id && document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    if (forLabel) return { label: forLabel, name: forLabel };
    const wrap = select.closest("label");
    if (!wrap) return {};
    let name = null;
    for (const node of [...wrap.childNodes]) {
      if (node === select) break;
      if (node.nodeType === 3 && node.textContent.trim()) {
        name = document.createElement("span");
        node.replaceWith(name);
        name.append(node);
        break;
      }
      if (node.nodeType === 1 && node.textContent.trim()) { name = node; break; }
    }
    return { label: wrap, name };
  }

  function enhanceOne(select) {
    if (select.classList.contains("ui-select-native")) return;
    const id = select.id || `ui-select-${++uid}`;
    const listId = `${id}-listbox`;

    const wrapper = document.createElement("span");
    wrapper.className = "ui-select";
    wrapper.dataset.for = id;
    wrapper.innerHTML = `<button type="button" class="ui-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}"><span class="ui-select-value"></span>${CHEVRON}</button>`;
    const trigger = wrapper.firstElementChild;
    const valueEl = trigger.firstElementChild;

    const { label, name } = labelFor(select);
    if (select.getAttribute("aria-label")) trigger.setAttribute("aria-label", select.getAttribute("aria-label"));
    else if (name) {
      name.id ||= `${id}-label`;
      trigger.setAttribute("aria-labelledby", name.id);
    }
    // Clicking the label would focus the hidden select; send focus to the trigger instead.
    label?.addEventListener("click", event => {
      if (wrapper.contains(event.target)) return;
      event.preventDefault();
      trigger.focus();
    });

    select.classList.add("ui-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.after(wrapper);

    const searchable = () => select.options.length >= SEARCH_MIN;
    const menu = document.createElement("div");
    menu.className = "ui-menu";
    menu.popover = "auto";
    menu.innerHTML = `<input class="ui-menu-search" type="text" placeholder="Search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${listId}" autocomplete="off" spellcheck="false"><div class="ui-menu-list" role="listbox" id="${listId}" tabindex="-1"></div>`;
    const search = menu.firstElementChild;
    const list = menu.lastElementChild;
    document.body.append(menu);

    let rows = [];      // option indexes currently rendered, in order
    let active = -1;    // position in rows
    let typed = "", typedAt = 0, wasOpen = false;
    const isOpen = () => menu.matches(":popover-open");
    const focusHost = () => (searchable() ? search : trigger);

    function sync() {
      valueEl.textContent = select.selectedOptions[0]?.text ?? "";
      swatch(valueEl, select.selectedOptions[0]);
      trigger.disabled = select.disabled;
      wrapper.hidden = select.hidden;
      if (select.disabled && isOpen()) menu.hidePopover();
    }

    function render() {
      const query = searchable() ? search.value.trim().toLowerCase() : "";
      const matches = [];
      for (const option of select.options) if (!query || option.text.toLowerCase().includes(query)) matches.push(option.index);
      // Without a query, centre the rendered window on the selected option so it is always shown.
      const from = query ? 0 : Math.max(0, Math.min(select.selectedIndex - RENDER_MAX / 2, matches.length - RENDER_MAX));
      rows = matches.slice(from, from + RENDER_MAX);
      const frag = document.createDocumentFragment();
      for (const index of rows) {
        const option = select.options[index];
        const row = document.createElement("div");
        row.className = "ui-menu-item";
        row.id = `${id}-option-${index}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === select.selectedIndex));
        row.dataset.index = index;
        row.textContent = option.text;
        swatch(row, option);
        frag.append(row);
      }
      if (!matches.length) frag.append(note("No matches"));
      else if (matches.length > rows.length) frag.append(note(`Type to narrow ${(matches.length - rows.length).toLocaleString("en")} more`));
      list.replaceChildren(frag);
      const selectedRow = rows.indexOf(select.selectedIndex);
      setActive(query ? 0 : selectedRow >= 0 ? selectedRow : 0);
    }

    // An option with data-swatch shows that colour as a dot before its label (tokens.css .has-swatch)
    function swatch(el, option) {
      const color = option?.dataset.swatch;
      el.classList.toggle("has-swatch", !!color);
      el.style.setProperty("--swatch", color || "");
    }

    function note(text) {
      const row = document.createElement("div");
      row.className = "ui-menu-note";
      row.setAttribute("role", "presentation");
      row.textContent = text;
      return row;
    }

    function setActive(position, scroll = true) {
      list.querySelector(".ui-menu-item.is-active")?.classList.remove("is-active");
      active = rows.length ? Math.max(0, Math.min(rows.length - 1, position)) : -1;
      const row = active >= 0 ? list.children[active] : null;
      row?.classList.add("is-active");
      if (row) focusHost().setAttribute("aria-activedescendant", row.id);
      else focusHost().removeAttribute("aria-activedescendant");
      if (row && scroll) row.scrollIntoView({ block: "nearest" });
    }

    function place() {
      if (!isOpen()) return;
      const r = trigger.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      menu.style.minWidth = `${Math.min(r.width, vw - 2 * PAD)}px`;
      menu.style.maxWidth = `${vw - 2 * PAD}px`;
      menu.style.maxHeight = "320px";
      const natural = menu.offsetHeight;
      const below = vh - r.bottom - GAP - PAD, above = r.top - GAP - PAD;
      const up = below < natural && above > below;
      const height = Math.min(natural, 320, Math.max(up ? above : below, 80));
      menu.style.maxHeight = `${height}px`;
      const left = Math.max(PAD, Math.min(r.left, vw - PAD - menu.offsetWidth));
      menu.style.left = `${left}px`;
      menu.style.top = `${up ? r.top - GAP - menu.offsetHeight : r.bottom + GAP}px`;
    }

    function open(seed = "") {
      if (select.disabled || isOpen()) return;
      search.hidden = !searchable();
      search.value = seed && searchable() ? seed : "";
      render();
      menu.showPopover();
      trigger.setAttribute("aria-expanded", "true");
      place();
      if (searchable()) search.focus();
      list.children[active]?.scrollIntoView({ block: "nearest" });
    }

    function close(refocus = true) {
      if (isOpen()) menu.hidePopover();
      if (refocus) trigger.focus();
    }

    function choose(position) {
      const index = rows[position];
      if (index !== undefined && index !== select.selectedIndex) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    function typeAhead(char) {
      const now = Date.now();
      typed = now - typedAt > 500 ? char : typed + char;
      typedAt = now;
      const texts = [...select.options].map(option => option.text.toLowerCase());
      const current = isOpen() ? rows[active] ?? select.selectedIndex : select.selectedIndex;
      const start = typed.length === 1 ? current + 1 : current;
      for (let step = 0; step < texts.length; step++) {
        const index = (Math.max(start, 0) + step) % texts.length;
        if (texts[index].startsWith(typed)) {
          if (!isOpen()) open();
          setActive(rows.indexOf(index));
          return;
        }
      }
    }

    function onKey(event) {
      const key = event.key;
      if (event.altKey && key === "ArrowDown" && !isOpen()) { event.preventDefault(); open(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isOpen()) {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(key)) { event.preventDefault(); open(); }
        else if (key.length === 1 && key !== " ") {
          event.preventDefault();
          if (searchable()) open(key); else typeAhead(key.toLowerCase());
        }
        return;
      }
      const inSearch = event.target === search;
      switch (key) {
        case "ArrowDown": event.preventDefault(); setActive(active + 1); break;
        case "ArrowUp": event.preventDefault(); setActive(active - 1); break;
        case "Home": if (!inSearch) { event.preventDefault(); setActive(0); } break;
        case "End": if (!inSearch) { event.preventDefault(); setActive(rows.length - 1); } break;
        case "PageDown": event.preventDefault(); setActive(active + 10); break;
        case "PageUp": event.preventDefault(); setActive(active - 10); break;
        case "Enter": event.preventDefault(); choose(active); close(); break;
        case "Escape": event.preventDefault(); event.stopPropagation(); close(); break;
        // Focus the trigger first so the browser's Tab moves on from there.
        case "Tab": choose(active); close(); break;
        default:
          if (key === " " && !inSearch) { event.preventDefault(); choose(active); close(); }
          else if (!inSearch && key.length === 1) { event.preventDefault(); typeAhead(key.toLowerCase()); }
      }
    }

    trigger.addEventListener("pointerdown", () => { wasOpen = isOpen(); });
    trigger.addEventListener("click", event => {
      if (event.detail === 0) return; // keyboard activation is handled in onKey
      if (wasOpen || isOpen()) { wasOpen = false; close(); } else open();
    });
    trigger.addEventListener("keydown", onKey);
    search.addEventListener("keydown", onKey);
    search.addEventListener("input", render);
    // Keep focus on the trigger (or the search box) while clicking rows.
    menu.addEventListener("mousedown", event => { if (event.target !== search) event.preventDefault(); });
    list.addEventListener("pointermove", event => {
      const row = event.target.closest(".ui-menu-item");
      if (row) setActive(rows.indexOf(Number(row.dataset.index)), false);
    });
    list.addEventListener("click", event => {
      const row = event.target.closest(".ui-menu-item");
      if (!row) return;
      choose(rows.indexOf(Number(row.dataset.index)));
      close();
    });
    menu.addEventListener("toggle", event => {
      if (event.newState === "open") return;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (menu.contains(document.activeElement)) trigger.focus();
    });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", event => { if (!menu.contains(event.target)) place(); }, true);

    for (const prop of ["value", "selectedIndex"]) {
      const native = Object.getOwnPropertyDescriptor(proto, prop);
      Object.defineProperty(select, prop, {
        configurable: true,
        get() { return native.get.call(this); },
        set(value) { native.set.call(this, value); sync(); },
      });
    }
    new MutationObserver(() => { sync(); if (isOpen()) { render(); place(); } })
      .observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
    select.addEventListener("change", sync);
    sync();
  }

  // Arrow-key focus movement for a popover of buttons, such as the target list.
  function menuKeys(popover) {
    if (!popover) return;
    const items = () => [...popover.querySelectorAll("button:not(:disabled)")];
    popover.addEventListener("toggle", event => {
      if (event.newState !== "open") return;
      (popover.querySelector('[aria-current="true"]') || items()[0])?.focus();
    });
    popover.addEventListener("keydown", event => {
      const list = items(), at = list.indexOf(document.activeElement);
      const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
      if (next === undefined || !list.length) return;
      event.preventDefault();
      list[(next + list.length) % list.length].focus();
    });
  }

  function enhance(root = document) {
    for (const select of root.querySelectorAll("select")) enhanceOne(select);
  }

  window.UISelect = { enhance };
  const start = () => { enhance(); menuKeys(document.getElementById("target-popover")); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
