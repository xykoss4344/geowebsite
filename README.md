# GeogJon IBDP — rebuilt

A static rebuild of [geogjon.weebly.com](https://geogjon.weebly.com/), an IB Diploma
Programme Geography resource site for grades 11–12.

All 150 pages, 1,110 outbound links, 101 video embeds and 83 files/images were carried
over from the original. What's new: full-text search, a flat sidebar instead of
three-level hover menus, a real mobile layout, dark mode, prev/next paging, and a
browser-based editor so non-technical staff can maintain it.

## Editing the site (for teachers)

Go to **`/admin`** on the live site and log in with the email you were invited on.
No GitHub account, no software to install.

- **Edit a page** — pick a unit in the left sidebar, pick a page, edit, click Publish.
- **Add a page** — "New page". Set *Sits under* to slot it beneath an existing page
  (leave empty for a top-level page in that unit), and *Position* to order it among
  its siblings — lower numbers first.
- **Images and files** — drag them into the editor; they're uploaded to `assets/`.
- **Videos** — the "+" button in the toolbar → *YouTube video* → paste the link.

Publishing saves your change and rebuilds the site. It's live in about a minute.
Every change is a version in Git, so nothing is ever really lost.

To invite someone: Netlify dashboard → **Identity** → *Invite users*. Note that a
Netlify account is not an Identity user — invite your own email too, or you can't log in.

### Trying it without an account

**`/admin/demo.html`** is the same editor with no login, running against an in-browser
copy of the content. Edits there are thrown away on refresh and never reach the repo.
Use it to practise or to show someone the editor; use `/admin` for real work.

## How it works

Content is Markdown in `content/`, one file per page:

```
content/2-global-climate/atmospheric-system.md
---
title: Atmospheric system
parent: global-climate-change      # optional; a page slug in the same unit
order: 20                          # lower comes first
source: https://geogjon.weebly.com/…   # optional, the original Weebly page
---
body…
```

The folder is the unit, `parent` + `order` are the sidebar position — so creating a
file *is* adding it to the nav. There is no separate nav file to keep in sync.
Unit names and their order live in `content/units.json`.

`build.js` compiles all of that into `content.json`, which `app.js` renders. Markdown
becomes typed blocks (paragraph, heading, image, embed, download) that are inserted as
text nodes, never as HTML, so authored content cannot inject markup.

The one non-Markdown thing is `{{youtube VIDEO_ID}}`, which becomes a video embed.

Adding a *unit* is the only job that needs a developer: add it to `content/units.json`
and add a matching collection to `admin/config.yml`.

## Running it locally

```sh
node build.js            # content/ -> content.json
python -m http.server 8000
# then open http://localhost:8000
```

`content.json` is generated and git-ignored — build it before serving. `app.js` fetches
it, so opening `index.html` off disk will not work.

```sh
node test.js             # checks the Markdown -> block compiler
```

## Deployment

Netlify free tier, wired to this repo: `netlify.toml` runs `node build.js` on every
push, including the pushes the CMS makes. No dependencies to install, nothing to pay
for, no server to run.

Auth is Netlify Identity (invite-only) plus Git Gateway, so editors commit through
Netlify rather than needing GitHub accounts of their own. Enable both in the Netlify
dashboard: **Identity → Enable**, set registration to *Invite only*, then
**Services → Git Gateway → Enable**.

## Re-scraping

`scrape.py` still rebuilds `content.json` and `assets/` from the live Weebly site, but
it is now historical: `content/` is the source of truth and a re-scrape would overwrite
edits made in the CMS. It needs `requests` and `bs4`.

## Files

| File | |
|---|---|
| `content/` | all page content as Markdown — the source of truth |
| `build.js` | compiles `content/` into `content.json` |
| `admin/` | the CMS (Decap): `config.yml` defines the editing forms |
| `index.html` | page shell |
| `style.css` | all styling; palette is CSS custom properties at the top |
| `app.js` | routing, rendering, search |
| `test.js` | self-check for `build.js` |
| `netlify.toml` | build command for the host |
| `scrape.py` | original Weebly scrape (historical) |
