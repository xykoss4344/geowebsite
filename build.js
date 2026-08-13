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

// Only the subset the CMS can produce: bold, links, and bold links.
function inline(md) {
  const runs = [];
  const push = (t, extra) => {
    if (!t) return;
    const run = { t: unescape(t) };
    if (extra && extra.href) run.href = extra.href;
    if (extra && extra.b) run.b = true;
    runs.push(run);
  };

  const re = /\[([^\]]*)\]\(([^)\s]+)\)|(\*\*|__)([\s\S]+?)\3/g;
  let last = 0;
  let m;
  while ((m = re.exec(md)) !== null) {
    push(md.slice(last, m.index));
    if (m[1] !== undefined) {
      const bold = /^\*\*[\s\S]+\*\*$/.test(m[1]);
      push(bold ? m[1].slice(2, -2) : m[1], { href: m[2], b: bold });
    } else {
      push(m[4], { b: true });
    }
    last = re.lastIndex;
  }
  push(md.slice(last));
  return runs;
}

const YT = /^\{\{youtube\s+([^}\s]+)\}\}$/;
const IMG = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const FILE = /^\[([^\]]*)\]\((assets\/[^)\s]+)\)$/;

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
    } else if ((m = IMG.exec(chunk))) {
      blocks.push({ type: "image", src: m[2], alt: unescape(m[1]) || "Picture" });
    } else if ((m = FILE.exec(chunk)) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(m[2])) {
      blocks.push({ type: "file", href: m[2], name: unescape(m[1]) });
    } else if ((m = /^(#{2,6})\s+(.+)$/.exec(chunk))) {
      blocks.push({ type: "heading", text: unescape(m[2]) });
    } else {
      blocks.push({ type: "text", runs: inline(chunk) });
    }
  }
  return blocks;
}

function youtubeId(url) {
  const m = /(?:youtu\.be\/|v=|embed\/)([\w-]+)/.exec(url);
  return m ? m[1] : url;
}

/* ---------------- assemble ---------------- */

function build() {
  const units = JSON.parse(fs.readFileSync(path.join(CONTENT, "units.json"), "utf8"));
  const pages = {};
  const meta = {}; // slug -> { unit, parent, order, title }

  for (const unit of units) {
    const dir = path.join(CONTENT, unit.dir);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const slug = file.replace(/\.md$/, "");
      if (pages[slug]) throw new Error(`duplicate page slug: ${slug}`);
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

  for (const [slug, m] of Object.entries(meta)) {
    if (m.parent && !meta[m.parent]) throw new Error(`${slug}: unknown parent "${m.parent}"`);
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

/* admin/demo.html runs the CMS against an in-browser copy of content/ (Decap's
   test backend reads window.repoFiles), so anyone can try editing without a login
   and without touching the repo. */
function demoFiles() {
  const tree = {};
  for (const unit of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    if (!unit.isDirectory()) continue;
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
  console.log(`content.json: ${Object.keys(out.pages).length} pages, ${out.nav.length} units`);
}

module.exports = { build, parseBody, inline, parseFile };
