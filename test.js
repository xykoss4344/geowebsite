/* Checks build.js: the Markdown the CMS writes must land as the block shapes
   app.js renders. Run: node test.js */

const assert = require("assert");
const { parseBody, build } = require("./build");

const one = (md) => parseBody(md)[0];

// bold, links, and bold links inside a paragraph
assert.deepStrictEqual(one("**Starter:** watch [**this**](http://x.com/a) now.").runs, [
  { t: "Starter:", b: true },
  { t: " watch " },
  { t: "this", href: "http://x.com/a", b: true },
  { t: " now." },
]);

// media blocks
assert.deepStrictEqual(one("{{youtube abc123}}"),
  { type: "embed", src: "https://www.youtube.com/embed/abc123?wmode=opaque" });
assert.deepStrictEqual(one("{{youtube https://youtu.be/abc123}}"),
  { type: "embed", src: "https://www.youtube.com/embed/abc123?wmode=opaque" });
assert.deepStrictEqual(one("![Ice sheet](assets/ice.png)"),
  { type: "image", src: "assets/ice.png", alt: "Ice sheet" });
assert.deepStrictEqual(one("[glossary.pdf](assets/glossary.pdf)"),
  { type: "file", href: "assets/glossary.pdf", name: "glossary.pdf" });
assert.deepStrictEqual(one("## Key terms"), { type: "heading", text: "Key terms" });
assert.deepStrictEqual(one("# Key terms"), { type: "heading", text: "Key terms" });

// italic, and the toolbar's list buttons (these used to publish literal "- one")
assert.deepStrictEqual(one("some *italic* text").runs,
  [{ t: "some " }, { t: "italic", i: true }, { t: " text" }]);
assert.deepStrictEqual(one("- one\n- two"),
  { type: "list", ordered: false, items: [[{ t: "one" }], [{ t: "two" }]] });
assert.deepStrictEqual(one("1. first\n2. second"),
  { type: "list", ordered: true, items: [[{ t: "first" }], [{ t: "second" }]] });
assert.deepStrictEqual(one("- see [BBC](https://bbc.co.uk)").items,
  [[{ t: "see " }, { t: "BBC", href: "https://bbc.co.uk" }]]);

// escaped delimiters stay literal: the cloze exercises are written \_\_\_\_\_
assert.strictEqual(one("the atmosphere is an \\_\\_\\_\\_ system").runs.length, 1);
assert.strictEqual(one("the atmosphere is an \\_\\_\\_\\_ system").runs[0].t,
  "the atmosphere is an ____ system");
assert.strictEqual(one("2 \\* 3 \\* 4").runs.length, 1);

// a "loose" list (blank line between items) is still one list
assert.deepStrictEqual(parseBody("- one\n\n- two").length, 1);
assert.deepStrictEqual(one("- one\n\n- two").items.length, 2);
// ...but a bullet list and a numbered list stay separate
assert.strictEqual(parseBody("- one\n\n1. two").length, 2);

// things that only look like list markers
assert.strictEqual(one("---").type, "text");
assert.strictEqual(one("**bold**").type, "text");
assert.strictEqual(one("- one\nnot an item").type, "text");

// an image link is an image, not a download; a bare external link stays inline text
assert.strictEqual(one("[pic](assets/a.png)").type, "text");
assert.strictEqual(one("[BBC](https://bbc.co.uk)").type, "text");

// blank lines split blocks; single newlines stay inside one (.para is pre-wrap)
assert.strictEqual(parseBody("one\ntwo\n\nthree").length, 2);
assert.strictEqual(one("one\ntwo").runs[0].t, "one\ntwo");
assert.strictEqual(one("one\\\ntwo").runs[0].t, "one\ntwo"); // Decap soft break
assert.strictEqual(one("2 \\* 3 \\[x\\]").runs[0].t, "2 * 3 [x]"); // escapes

// the real content tree still assembles
const site = build();
assert.strictEqual(Object.keys(site.pages).length, 150);
assert.strictEqual(site.nav.length, 6);
assert.strictEqual(site.nav[0].slug, "home");
assert.ok(site.pages["atmospheric-system"].blocks.length > 0);

/* The site is shared between schools, so it must not name any one of them, and it
   must not link back to the personal Weebly it was migrated from. Both crept in via
   scraped content once; this fails the moment either returns. Runs over content/ and
   assets/ — content.json and admin/demo-files.js are generated from content/, so
   guarding the source covers them. */
{
  const fs = require("fs");
  const path = require("path");
  const offenders = [];

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/ishcmc/i.test(e.name)) offenders.push(`${p}: filename names a school`);
      if (!e.name.endsWith(".md")) continue;
      fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (/ishcmc/i.test(line)) offenders.push(`${p}:${i + 1}: names a school`);
        // `source:` is provenance metadata, not a live link — exempt.
        if (!/^source:/.test(line) && /geogjon\.weebly\.com/.test(line))
          offenders.push(`${p}:${i + 1}: links back to the old Weebly (use #/slug)`);
      });
    }
  };
  walk(`${__dirname}/content`);
  walk(`${__dirname}/assets`);

  assert.strictEqual(offenders.length, 0,
    `content must not be tied to one school or the old Weebly:\n  ${offenders.join("\n  ")}`);
}

console.log("build.js OK");

/* `node test.js --net` also checks every pinned CDN script still resolves and still
   matches its integrity hash. A wrong path returns a 200-shaped "Not found" body that
   fails silently in the browser, which once broke Identity logins with no error. */
if (process.argv.includes("--net")) {
  const { createHash } = require("crypto");
  const fs = require("fs");
  const re =
    /s?r?c?\.?src\s*=\s*["'](https:\/\/[^"']+)["'][\s\S]{0,240}?integrity\s*=?\s*["'](sha384-[^"']+)["']/g;

  (async () => {
    let n = 0;
    for (const file of ["index.html", "admin/index.html", "admin/demo.html"]) {
      const html = fs.readFileSync(`${__dirname}/${file}`, "utf8");
      for (const [, url, integrity] of html.matchAll(re)) {
        const res = await fetch(url);
        assert.strictEqual(res.status, 200, `${file}: ${url} returned ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        const got = "sha384-" + createHash("sha384").update(body).digest("base64");
        assert.strictEqual(got, integrity, `${file}: integrity mismatch for ${url}`);
        assert.ok(body.length > 10000, `${file}: ${url} is only ${body.length} bytes — wrong path?`);
        n++;
      }
    }
    console.log(`pinned scripts OK: ${n} checked`);
  })();
}
