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
