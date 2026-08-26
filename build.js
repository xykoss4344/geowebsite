/* Compiles content/ (Markdown, edited in the CMS) into content.json, which
   app.js already knows how to render. No dependencies: Netlify runs `node build.js`.

   Page file: content/<unit-dir>/<slug>.md
     ---
     title: Population distribution
     parent: population-and-economic-development-patterns   (optional)
     order: 20
     source: https://geogjon.weebly.com/...                 (optional)
     ---
     body markdown

   Nav position comes from the file's folder (unit) + parent + order, so adding
   a page in the CMS adds it to the nav. There is no separate nav file to forget. */

const fs = require("fs");
const path = require("path");

const CONTENT = path.join(__dirname, "content");

/* ---------------- frontmatter ---------------- */

function parseFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^"[\s\S]*"$/.test(val)) val = JSON.parse(val);
    else if (/^'[\s\S]*'$/.test(val)) val = val.slice(1, -1).replace(/''/g, "'");
    meta[key] = val;
  }
  return { meta, body: m[2] };
}

/* ---------------- markdown -> blocks ---------------- */

const unescape = (s) => s.replace(/\\([\\`*_{}\[\]()#+\-.!])/g, "$1");

// Only the subset the CMS toolbar can produce: bold, italic, links, and bold links.
// admin/config.yml hides every other button, so anything not handled here also
// cannot be authored — keep the two in sync when adding a button.

// Decap wraps a link target in more shapes than the plain one: a title
// ([t](url "title")), angle brackets when the URL contains a space ([t](<a b>)),
// or both. Strip the packaging so every caller sees just the URL.
// A link typed as "www.bbc.co.uk" or "bbc.co.uk/news" has no scheme, so the browser
// reads it as a path inside this site and the click goes nowhere — the reason links
// had to be copied into the address bar by hand. Anything with a scheme, an anchor,
// or a repo-relative path (assets/…) is left exactly as it is.
const NEEDS_SCHEME = /^(?:www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*)$/i;

const cleanUrl = (u) => {
  u = u.trim().replace(/\s+("|')[\s\S]*\1$/, "").trim();
  if (/^<[\s\S]*>$/.test(u)) u = u.slice(1, -1).trim();
  return NEEDS_SCHEME.test(u) ? "https://" + u : u;
};

function inline(md) {
  const runs = [];
  const push = (t, extra) => {
    if (!t) return;
    const run = { t: unescape(t) };
    if (extra && extra.href) run.href = extra.href;
    if (extra && extra.b) run.b = true;
    if (extra && extra.i) run.i = true;
    runs.push(run);
  };

  // Bold is listed before italic so ** wins over * on the same run. The (?<!\\)
  // guards keep escaped delimiters literal — the cloze exercises are written as
  // \_\_\_\_\_ and must not turn into italics. <https://…> is an autolink: Decap
  // writes one whenever a URL is its own link text.
  const re =
    /\[([^\]]*)\]\(([^)]*)\)|<((?:https?:|mailto:)[^>\s]+)>|(?<!\\)(\*\*|__)([\s\S]+?)(?<!\\)\4|(?<!\\)([*_])([^\s][\s\S]*?)(?<!\\)\6/g;
  let last = 0;
  let m;
  while ((m = re.exec(md)) !== null) {
    push(md.slice(last, m.index));
    if (m[1] !== undefined) {
      const bold = /^\*\*[\s\S]+\*\*$/.test(m[1]);
      const ital = !bold && /^[*_][\s\S]+[*_]$/.test(m[1]);
      push(bold || ital ? m[1].slice(bold ? 2 : 1, bold ? -2 : -1) : m[1],
           { href: cleanUrl(m[2]), b: bold, i: ital });
    } else if (m[3] !== undefined) {
      push(m[3], { href: m[3] });
    } else if (m[4] !== undefined) {
      push(m[5], { b: true });
    } else {
      push(m[7], { i: true });
    }
    last = re.lastIndex;
  }
  push(md.slice(last));
  return runs;
}

const YT = /^\{\{youtube\s+([^}\s]+)\}\}$/;
// Any YouTube link alone on its own line becomes a video — no toolbar button needed.
// Decap turns a pasted URL into [url](url), so that shape counts as "alone" too, but
// a link with real text ("[Watch this](...)") stays a link: the wording was deliberate.
const YT_ANY = /(?:youtube\.com\/(?:watch\?\S*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/;
const BARE_URL = /^<?(https?:\/\/[^>\s]+)>?$/;
const AUTOLINK = /^\[(\S+)\]\(([^)]*)\)$/;

function asYouTube(chunk) {
  let url = null;
  const a = AUTOLINK.exec(chunk);
  const bare = BARE_URL.exec(chunk);
  if (bare) url = bare[1];
  else if (a && a[1] === cleanUrl(a[2])) url = cleanUrl(a[2]);
  return url && YT_ANY.test(url) ? youtubeId(url) : null;
}
const LINK = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/;
// Uploads land in assets/, but Decap may write the path with a leading slash or
// "./" depending on public_folder — all three mean the same file.
const ASSET = /^(?:\.?\/)?assets\//;
const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i;
// A marker must be followed by a space, so "---", "**bold**" and "1997. A year"
// are not lists.
const UL = /^[-*+][ \t]+(.*)$/;
const OL = /^\d+[.)][ \t]+(.*)$/;

// A chunk is a list only if *every* line is an item; otherwise it stays a paragraph.
function asList(chunk) {
  const lines = chunk.split("\n");
  const ordered = OL.test(lines[0]);
  const re = ordered ? OL : UL;
  if (!lines.every((l) => re.test(l))) return null;
  return { type: "list", ordered, items: lines.map((l) => inline(re.exec(l)[1])) };
}

function parseBody(body) {
  const blocks = [];
  for (let chunk of body.split(/\r?\n[ \t]*\r?\n/)) {
    // Decap writes soft line breaks as a trailing backslash or two spaces.
    chunk = chunk.replace(/[ \t]*\\?[ \t]*(\r?\n)/g, "\n").trim();
    if (!chunk) continue;

    let m;
    if ((m = YT.exec(chunk))) {
      const id = /^[\w-]{6,}$/.test(m[1]) ? m[1] : youtubeId(m[1]);
      blocks.push({ type: "embed", src: `https://www.youtube.com/embed/${id}?wmode=opaque` });
    } else if ((m = asYouTube(chunk))) {
      blocks.push({ type: "embed", src: `https://www.youtube.com/embed/${m}?wmode=opaque` });
    } else if ((m = LINK.exec(chunk)) &&
               (m[1] || (ASSET.test(cleanUrl(m[3])) && !PICTURE.test(cleanUrl(m[3]))))) {
      // "!" means a picture; an uploaded non-picture alone on a line becomes a
      // download button. A picture linked without the "!" stays an ordinary link.
      const href = cleanUrl(m[3]);
      if (m[1]) blocks.push({ type: "image", src: href, alt: unescape(m[2]) || "Picture" });
      else blocks.push({ type: "file", href, name: unescape(m[2]) });
    } else if ((m = /^(#{1,6})\s+(.+)$/.exec(chunk))) {
      blocks.push({ type: "heading", text: unescape(m[2]) });
    } else if ((m = asList(chunk))) {
      // Decap writes a blank line between items when the list is "loose", which
      // splits one list into a chunk per item — glue those back together.
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "list" && prev.ordered === m.ordered) prev.items.push(...m.items);
      else blocks.push(m);
    } else {
      blocks.push({ type: "text", runs: inline(chunk) });
    }
  }
  return blocks;
}

function youtubeId(url) {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]+)/.exec(url);
  return m ? m[1] : url;
}

/* ---------------- assemble ---------------- */

/* Warnings, not errors: a build that fails leaves the whole site on the previous
   deploy, and the teacher who pressed Publish is never told why nothing changed.
   Everything recoverable is recovered here and reported in the Netlify deploy log. */
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`warning: ${msg}`);
};

// content/units.json is { "units": [ { dir, title, page? } ] } — an object, not a
// bare array, because Decap's file collection can only edit named fields.
function readUnits() {
  const raw = JSON.parse(fs.readFileSync(path.join(CONTENT, "units.json"), "utf8"));
  const units = (Array.isArray(raw) ? raw : raw.units).filter((u) => {
    if (fs.existsSync(path.join(CONTENT, u.dir))) return true;
    warn(`units.json: "${u.title}" points at content/${u.dir}, which does not exist — skipped`);
    return false;
  });

  // A unit dropped from units.json would take its pages off the site with it.
  // Put any unlisted folder back, at the end, rather than losing pages.
  for (const d of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    if (!d.isDirectory() || units.some((u) => u.dir === d.name)) continue;
    warn(`content/${d.name} is not listed in units.json — added at the end`);
    units.push({ dir: d.name, title: d.name.replace(/^\d+-/, "").replace(/-/g, " ") });
  }
  return units;
}

function build() {
  const units = readUnits();
  const pages = {};
  const meta = {}; // slug -> { unit, parent, order, title }

  for (const unit of units) {
    const dir = path.join(CONTENT, unit.dir);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      let slug = file.replace(/\.md$/, "");
      // Two pages can end up with the same slug in different units. Publishing is
      // the teacher's only feedback loop, so nothing here may fail the deploy: the
      // second page gets its own slug instead of taking the deploy down.
      if (pages[slug]) {
        let n = 2;
        while (pages[`${slug}-${n}`]) n++;
        warn(`two pages are called "${slug}" — the one in ${unit.dir} is now "${slug}-${n}"`);
        slug = `${slug}-${n}`;
      }
      const { meta: fm, body } = parseFile(fs.readFileSync(path.join(dir, file), "utf8"));
      pages[slug] = { title: fm.title || slug, blocks: parseBody(body) };
      if (fm.source) pages[slug].source = fm.source;
      meta[slug] = {
        unit: unit.dir,
        parent: fm.parent || null,
        order: Number(fm.order) || 0,
        title: pages[slug].title,
      };
    }
  }

  // A page whose parent was renamed or deleted becomes top-level rather than
  // failing the build — see the duplicate-slug note above.
  for (const [slug, m] of Object.entries(meta)) {
    if (m.parent && !meta[m.parent]) {
      warn(`"${slug}" sits under "${m.parent}", which no longer exists — showing it at the top level`);
      m.parent = null;
    }
  }

  const kids = (unitDir, parent) =>
    Object.entries(meta)
      .filter(([, m]) => m.unit === unitDir && m.parent === parent)
      .sort((a, b) => a[1].order - b[1].order || a[1].title.localeCompare(b[1].title))
      .map(([slug, m]) => ({ title: m.title, slug, children: kids(unitDir, slug) }));

  const nav = units.map((u) => ({
    title: u.title,
    // A unit that is itself a page (only "Changing Population" is) keeps that slug.
    slug: u.page || null,
    children: kids(u.dir, u.page || null).filter((n) => n.slug !== u.page),
  }));

  return { site: "GeogJon IBDP", nav, pages };
}

/* ---------------- CMS config ---------------- */

/* admin/config.yml is generated from content/units.json: one collection per unit,
   named and numbered in that file's order, plus a Units collection for editing that
   order. Six hand-written near-identical YAML blocks was how they drifted apart, and
   a unit renamed in units.json used to keep its old name in the editor sidebar.
   JSON is valid YAML, so this writes JSON and Decap reads it. */
const EDIT_HELP =
  'Click a page to edit it, or "New page" to add one. To add a video, paste the ' +
  "YouTube link on a line of its own. To add a picture or a worksheet, drag the " +
  "file straight into the page. Changes go live about a minute after you press Publish.";

function unitCollection(unit, i) {
  return {
    name: unit.dir,
    label: `${i + 1} · ${unit.title}`,
    label_singular: "page",
    description: EDIT_HELP,
    folder: `content/${unit.dir}`,
    create: true,
    slug: "{{slug}}",
    // The position leads the summary so the page list reads as the running order
    // rather than as a pile of titles.
    summary: "{{order}} · {{title}}",
    sortable_fields: ["order", "title"],
    fields: [
      { name: "title", label: "Page title", widget: "string" },
      {
        name: "parent",
        label: "Sits under",
        hint: "Leave empty to put this page straight in the unit's menu. " +
              "Pick a page to tuck this one underneath it.",
        widget: "relation",
        collection: unit.dir,
        search_fields: ["title"],
        display_fields: ["title"],
        value_field: "{{slug}}",
        required: false,
      },
      { name: "order",
        label: "Position in the menu (1 = top)",
        hint: "The menu runs top to bottom in number order: 1 sits at the top, then " +
              "2, then 3. Leave gaps (10, 20, 30) so a new page can be slotted in " +
              "between two others without renumbering the rest. Pages sharing a " +
              "number are listed alphabetically.",
        widget: "number", value_type: "int", default: 100 },
      // Provenance only — never shown to students, so teachers aren't asked to fill it in.
      { name: "source", label: "Source", widget: "hidden", required: false },
      {
        name: "body",
        label: "Page content",
        widget: "markdown",
        // Only the buttons parseBody() can render — a button that is shown but
        // unsupported silently publishes raw markup onto the live page.
        buttons: ["bold", "italic", "link", "heading-two", "heading-three",
                  "bulleted-list", "numbered-list"],
        editor_components: ["image", "youtube"],
        // No raw-markdown toggle: a teacher who hits it by accident sees ** and #
        // and has no idea what happened.
        modes: ["rich_text"],
      },
    ],
  };
}

function cmsConfig(units) {
  return {
    backend: { name: "git-gateway", branch: "main" },
    media_folder: "assets",
    public_folder: "assets",
    // Gives the CMS header a working "View site" link. Update if the site moves.
    site_url: "https://fascinating-tiramisu-145ac9.netlify.app",
    display_url: "https://fascinating-tiramisu-145ac9.netlify.app",
    // The site renders through its own block renderer, so Decap's generic preview
    // pane looks nothing like the published page. A preview that lies is worse.
    editor: { preview: false },
    collections: [
      ...units.map(unitCollection),
      {
        name: "units",
        label: "Units",
        files: [
          {
            name: "units",
            label: "Unit order and names",
            file: "content/units.json",
            description:
              "Rename a unit, or drag the units into a different order — the sidebar " +
              "on the site and in this editor both follow this list. The folder a " +
              "unit's pages live in cannot be changed here.",
            fields: [
              {
                name: "units",
                label: "Units",
                label_singular: "unit",
                widget: "list",
                summary: "{{fields.title}}",
                fields: [
                  { name: "title", label: "Unit name", widget: "string" },
                  {
                    name: "dir",
                    label: "Folder (leave as it is)",
                    hint: "Which folder this unit's pages live in. Changing it empties the unit.",
                    widget: "select",
                    options: units.map((u) => u.dir),
                  },
                  // The unit's own landing page, where it has one. Hidden so it
                  // survives an edit without a teacher having to understand it.
                  { name: "page", label: "Unit page", widget: "hidden", required: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/* admin/demo.html runs the CMS against an in-browser copy of content/ (Decap's
   test backend reads window.repoFiles), so anyone can try editing without a login
   and without touching the repo. */
function demoFiles() {
  const tree = {};
  for (const unit of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    if (!unit.isDirectory()) {
      tree[unit.name] = { path: `content/${unit.name}`,
                          content: fs.readFileSync(path.join(CONTENT, unit.name), "utf8") };
      continue;
    }
    const dir = (tree[unit.name] = {});
    for (const file of fs.readdirSync(path.join(CONTENT, unit.name))) {
      const rel = `content/${unit.name}/${file}`;
      dir[file] = { path: rel, content: fs.readFileSync(path.join(CONTENT, unit.name, file), "utf8") };
    }
  }
  return { content: tree };
}

if (require.main === module) {
  const out = build();
  fs.writeFileSync(path.join(__dirname, "content.json"), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "admin", "demo-files.js"),
    "window.repoFiles = " + JSON.stringify(demoFiles()) + ";\n");
  fs.writeFileSync(path.join(__dirname, "admin", "config.yml"),
    "# Generated by build.js from content/units.json — edit that, or build.js.\n" +
    JSON.stringify(cmsConfig(readUnits()), null, 2) + "\n");
  console.log(`content.json: ${Object.keys(out.pages).length} pages, ${out.nav.length} units`);
  if (warnings.length)
    console.log(`${warnings.length} problem(s) were worked around — see the warnings above. ` +
                "The site published anyway.");
}

module.exports = { build, parseBody, inline, parseFile, cmsConfig, readUnits };
