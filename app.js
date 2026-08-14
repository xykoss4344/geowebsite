/* GeogJon IBDP — static site renderer. No dependencies, no build step.
   All page text comes from content.json and is inserted as text nodes,
   never as HTML, so authored content can never inject markup. */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let DATA = { nav: [], pages: {} };
const ORDER = [];            // flat reading order of nav entries with a page
const PARENT = new Map();    // slug -> parent nav node
const NODE = new Map();      // slug -> nav node

/* ---------------- nav ---------------- */

function indexNav(nodes, parent) {
  for (const n of nodes) {
    if (n.slug) {
      NODE.set(n.slug, n);
      if (parent) PARENT.set(n.slug, parent);
      ORDER.push(n);
    }
    indexNav(n.children, n.slug ? n : parent);
  }
}

function chevron() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "chev");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M9 5l7 7-7 7");
  svg.append(p);
  return svg;
}

function buildNav() {
  const frag = document.createDocumentFragment();

  const home = el("a", "d1", "Home");
  home.href = "#/home";
  home.dataset.slug = "home";
  frag.append(home);

  for (const unit of DATA.nav) {
    const d = el("details", "unit");
    const s = el("summary");
    s.append(chevron(), el("span", null, unit.title));
    d.append(s);

    const ul = el("ul");
    // A unit that is itself a page (its summary can't be a link) gets an Overview entry.
    if (unit.slug && unit.slug !== "home") {
      const li = el("li");
      const a = el("a", "d2", "Overview");
      a.href = "#/" + unit.slug;
      a.dataset.slug = unit.slug;
      li.append(a);
      ul.append(li);
    }
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const li = el("li");
        if (n.slug) {
          const a = el("a", "d" + depth, n.title);
          a.href = "#/" + n.slug;
          a.dataset.slug = n.slug;
          li.append(a);
        } else {
          li.append(el("div", "d" + depth, n.title));
        }
        ul.append(li);
        if (n.children.length) walk(n.children, depth + 1);
      }
    };
    walk(unit.children, 2);
    d.append(ul);
    frag.append(d);
  }

  // Teachers had no way back to the editor except remembering to type /admin.
  // Students see it too; it only ever shows them a login box.
  const edit = el("a", "edit-link", "Edit this site");
  edit.href = "/admin/";
  frag.append(edit);

  $("#sidebar").replaceChildren(frag);
}

function markActive(slug) {
  for (const a of document.querySelectorAll("#sidebar a")) {
    if (a.dataset.slug === slug) {
      a.setAttribute("aria-current", "page");
      const d = a.closest("details");
      if (d) d.open = true;
      a.scrollIntoView({ block: "nearest" });
    } else {
      a.removeAttribute("aria-current");
    }
  }
}

/* ---------------- block rendering ---------------- */

function renderRuns(runs, tag, cls) {
  const p = el(tag || "p", cls === undefined ? "para" : cls);
  for (const r of runs) {
    let node = document.createTextNode(r.t);
    if (r.b) {
      const b = el("strong");
      b.append(node);
      node = b;
    }
    if (r.i) {
      const i = el("em");
      i.append(node);
      node = i;
    }
    if (r.href) {
      const a = el("a");
      a.href = r.href;
      if (/^https?:/i.test(r.href)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.append(node);
      node = a;
    }
    p.append(node);
  }
  return p;
}

function fileIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M14 3v5h5", "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z",
                   "M12 11v6", "M9.5 14.5L12 17l2.5-2.5"]) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

function renderBlock(b) {
  switch (b.type) {
    case "heading":
      return el("h2", null, b.text);

    case "text":
      return renderRuns(b.runs);

    case "list": {
      const list = el(b.ordered ? "ol" : "ul", "list");
      for (const item of b.items) list.append(renderRuns(item, "li", null));
      return list;
    }

    case "image": {
      const img = el("img");
      img.src = b.src;
      img.alt = b.alt || "";
      img.loading = "lazy";
      return img;
    }

    case "embed": {
      const wrap = el("div", "embed");
      const f = el("iframe");
      f.src = b.src;
      f.loading = "lazy";
      f.allowFullscreen = true;
      f.title = "Embedded video";
      wrap.append(f);
      return wrap;
    }

    case "file": {
      const a = el("a", "file");
      a.href = b.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const txt = el("span");
      txt.append(el("span", null, b.name), el("small", null, "Download file"));
      a.append(fileIcon(), txt);
      return a;
    }
  }
  return el("div");
}

/* ---------------- pages ---------------- */

function breadcrumb(slug) {
  const chain = [];
  for (let p = PARENT.get(slug); p; p = PARENT.get(p.slug)) chain.unshift(p);
  if (!chain.length) return null;
  const c = el("div", "crumb");
  chain.forEach((n, i) => {
    if (i) c.append(el("span", null, "›"));
    const a = el("a", null, n.title);
    a.href = "#/" + n.slug;
    c.append(a);
  });
  return c;
}

function childCards(node) {
  const kids = (node?.children || []).filter((k) => k.slug);
  if (!kids.length) return null;
  const ul = el("ul", "cards");
  for (const k of kids) {
    const li = el("li");
    const a = el("a");
    a.href = "#/" + k.slug;
    a.append(document.createTextNode(k.title));
    const n = (k.children || []).filter((x) => x.slug).length;
    if (n) a.append(el("small", null, n + (n === 1 ? " page" : " pages")));
    li.append(a);
    ul.append(li);
  }
  return ul;
}

function pager(slug) {
  const i = ORDER.findIndex((n) => n.slug === slug);
  if (i < 0) return null;
  const nav = el("nav", "pager");
  nav.setAttribute("aria-label", "Previous and next page");
  const link = (n, cls, label) => {
    const a = el("a", cls);
    a.href = "#/" + n.slug;
    a.append(el("small", null, label), document.createTextNode(n.title));
    return a;
  };
  if (i > 0) nav.append(link(ORDER[i - 1], "prev", "← Previous"));
  if (i < ORDER.length - 1) nav.append(link(ORDER[i + 1], "next", "Next →"));
  return nav.children.length ? nav : null;
}

/* The original conflated the site root with the "Changing Population" unit
   (its nav href was "/"). Home keeps the intro text but lists all six units;
   Changing Population's own pages stay reachable from the sidebar. */
function renderHome() {
  const art = el("article");
  const hero = el("div", "hero");
  hero.append(el("h1", null, "IB Diploma Programme Geography"));
  for (const b of (DATA.pages.home?.blocks || []).slice(1)) art.append(renderBlock(b));
  art.prepend(hero);

  art.append(el("h2", null, "Course units"));
  const ul = el("ul", "cards");
  for (const unit of DATA.nav) {
    const li = el("li");
    const a = el("a");
    a.href = "#/" + (firstSlug(unit) || "home");
    a.append(document.createTextNode(unit.title));
    a.append(el("small", null, countPages(unit) + " pages"));
    li.append(a);
    ul.append(li);
  }
  art.append(ul);
  $("#main").replaceChildren(art);
}

const firstSlug = (n) => n.slug || n.children.map(firstSlug).find(Boolean) || null;
const countPages = (n) =>
  (n.slug ? 1 : 0) + n.children.reduce((a, c) => a + countPages(c), 0);

function renderPage(slug) {
  if (slug === "home") return renderHome();

  const page = DATA.pages[slug];
  const node = NODE.get(slug);

  if (!page) {
    const art = el("article");
    art.append(el("h1", null, "Page not found"));
    const back = el("a", null, "← Back to home");
    back.href = "#/home";
    art.append(el("p", "note", "No page matches “" + slug + "”."), back);
    $("#main").replaceChildren(art);
    return;
  }

  const art = el("article");
  const crumb = breadcrumb(slug);
  if (crumb) art.append(crumb);
  art.append(el("h1", null, node?.title || page.title));

  for (const b of page.blocks) art.append(renderBlock(b));

  const cards = childCards(node);
  if (cards) art.append(cards);
  if (!page.blocks.length && !cards) {
    art.append(el("p", "note", "This page has no content yet."));
  }

  // Pages written in the CMS have no Weebly original to link back to.
  if (page.source) {
    const src = el("p", "src");
    const a = el("a", null, "View original page");
    a.href = page.source;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    src.append(a);
    art.append(src);
  }

  $("#main").replaceChildren(art);
  const p = pager(slug);
  if (p) $("#main").append(p);
}

/* ---------------- search ---------------- */

// ponytail: linear scan of 150 pages per keystroke (~28k words, <5ms).
// Add an inverted index only if it measurably lags.
let INDEX = [];

function buildIndex() {
  INDEX = Object.entries(DATA.pages).map(([slug, p]) => {
    const text = p.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.runs.map((r) => r.t).join(""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const title = NODE.get(slug)?.title || p.title;
    return { slug, title, text, hay: (title + " " + text).toLowerCase() };
  });
}

function search(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const p of INDEX) {
    let score = 0;
    let ok = true;
    for (const t of terms) {
      if (!p.hay.includes(t)) { ok = false; break; }
      if (p.title.toLowerCase().includes(t)) score += 50;
      score += p.text.toLowerCase().split(t).length - 1;
    }
    if (ok) hits.push({ p, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.p.title.localeCompare(b.p.title))
             .slice(0, 40);
}

function snippet(text, term) {
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 60);
  return (start ? "…" : "") + text.slice(start, start + 200);
}

function renderResults(q) {
  const hits = search(q);
  const main = $("#main");
  const head = el("h1", null,
    hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"} for “${q}”`
                : `No results for “${q}”`);
  main.replaceChildren(head);
  if (!hits.length) {
    main.append(el("p", "note", "Try a single keyword, e.g. “migration” or “albedo”."));
    return;
  }

  const term = q.toLowerCase().split(/\s+/)[0];
  const ul = el("ul", "results");
  for (const { p } of hits) {
    const li = el("li");
    const a = el("a");
    a.href = "#/" + p.slug;

    const parent = PARENT.get(p.slug);
    if (parent) a.append(el("div", "crumb-sm", parent.title));
    a.append(el("h3", null, p.title));

    // highlight matches without innerHTML
    const para = el("p");
    const text = snippet(p.text, term);
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) para.append(text.slice(last, m.index));
      para.append(el("mark", null, m[0]));
      last = m.index + m[0].length;
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    para.append(text.slice(last));
    a.append(para);

    li.append(a);
    ul.append(li);
  }
  main.append(ul);
}

/* ---------------- routing & chrome ---------------- */

function route() {
  const slug = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "home";
  $("#search").value = "";
  renderPage(slug);
  markActive(slug);
  document.title = (NODE.get(slug)?.title || DATA.pages[slug]?.title || "Home") +
                   " — GeogJon IBDP";
  closeDrawer();
  window.scrollTo(0, 0);
}

const openDrawer = () => {
  $("#sidebar").classList.add("open");
  $("#scrim").hidden = false;
  $("#menu-btn").setAttribute("aria-expanded", "true");
};
const closeDrawer = () => {
  $("#sidebar").classList.remove("open");
  $("#scrim").hidden = true;
  $("#menu-btn").setAttribute("aria-expanded", "false");
};

function initChrome() {
  $("#menu-btn").addEventListener("click", () =>
    $("#sidebar").classList.contains("open") ? closeDrawer() : openDrawer());
  $("#scrim").addEventListener("click", closeDrawer);

  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-btn").addEventListener("click", () => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  });

  let t;
  $("#search").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(t);
    t = setTimeout(() => {
      if (q.length < 2) {
        if (!q) route();
        return;
      }
      renderResults(q);
    }, 120);
  });

  addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#search").focus();
    }
    if (e.key === "Escape") {
      closeDrawer();
      if (document.activeElement === $("#search")) $("#search").blur();
    }
  });

  addEventListener("hashchange", route);
}

/* Distinguish the ways this fails, because they need opposite fixes and the raw
   JSON parse error ("Unexpected token '<'") sends people hunting for a bug in the
   build that isn't there. An HTML body means something answered instead of the
   file — Netlify's access gate or a 404 page. */
fetch("content.json")
  .then(async (r) => {
    const body = await r.text();
    if (body.trimStart().startsWith("<")) {
      throw new Error(
        r.status === 401 || /edge-access|Login Redirect/.test(body)
          ? "This site is behind Netlify's access protection, so its content cannot " +
            "be loaded. A site administrator needs to turn off Site protection under " +
            "Site configuration → Access & security → Visitor access."
          : `The server returned a web page instead of the content file (HTTP ${r.status}). ` +
            "content.json is generated by the build — if this is a deployed site, check " +
            "that the deploy ran `node build.js`."
      );
    }
    if (!r.ok) throw new Error(`The server returned HTTP ${r.status}.`);
    return JSON.parse(body);
  })
  .then((d) => {
    DATA = d;
    indexNav(DATA.nav, null);
    buildIndex();
    // Page count changes as editors add pages, so don't hardcode it in index.html.
    $("#search").placeholder = `Search all ${INDEX.length} pages…`;
    buildNav();
    initChrome();
    route();
  })
  .catch((err) => {
    $("#main").replaceChildren(
      el("h1", null, "Could not load content"),
      el("p", "note", err.message),
      el("p", "note",
        "Running this locally? content.json is generated, not committed — run " +
        "`node build.js`, then serve over HTTP with `npx serve`. Opening index.html " +
        "straight off disk will not work.")
    );
  });
