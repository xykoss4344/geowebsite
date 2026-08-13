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
