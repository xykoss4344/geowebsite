# GeogJon IBDP — rebuilt

A static rebuild of [geogjon.weebly.com](https://geogjon.weebly.com/), an IB Diploma
Programme Geography resource site for grades 11–12.

All 150 pages, 1,110 outbound links, 101 video embeds and 83 files/images were carried
over from the original. What's new: full-text search, a flat sidebar instead of
three-level hover menus, a real mobile layout, dark mode, and prev/next paging.

## Running it

The page loads `content.json` with `fetch`, so it needs to be served over HTTP —
opening `index.html` straight off disk will not work.

```sh
python -m http.server 8000
# then open http://localhost:8000
```

## Editing content

Everything lives in **`content.json`** — no HTML to touch.

- `nav` is the unit tree: `{title, slug, children}`. `slug` is the page it links to,
  or `null` for a heading that is just a grouping label.
- `pages[slug]` is `{title, source, blocks}`.

A page is a list of blocks:

| Block | Shape |
|---|---|
| Paragraph | `{"type":"text","runs":[{"t":"words","href":"…","b":true}]}` |
| Heading | `{"type":"heading","text":"…"}` |
| Video | `{"type":"embed","src":"https://www.youtube.com/embed/…"}` |
| Image | `{"type":"image","src":"assets/…","alt":"…"}` |
| Download | `{"type":"file","href":"assets/….pdf","name":"….pdf"}` |

A paragraph is a list of *runs* so a link can sit mid-sentence. `href` makes a run a
link, `b` makes it bold; both are optional. `\n` inside `t` is a line break.

To add a page: add an entry to `pages`, then point a `nav` node's `slug` at it.

Text is inserted into the DOM as text nodes, never as HTML, so content in this file
cannot inject markup.

## Re-scraping

`scrape.py` rebuilds `content.json` and `assets/` from the live Weebly site. It needs
`requests` and `bs4`.

```sh
python scrape.py          # full scrape
python scrape.py --test   # parser self-check only
```

Any page that fails is listed in `failed.txt` rather than silently dropped.

## Files

| File | |
|---|---|
| `index.html` | page shell |
| `style.css` | all styling; palette is CSS custom properties at the top |
| `app.js` | routing, rendering, search |
| `content.json` | all content — the only file you need to edit |
| `scrape.py` | regenerates `content.json` from the original site |
