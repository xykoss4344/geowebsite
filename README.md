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

You do **not** need a Netlify account. The login is plain email + password on this
site — you set the password yourself from the invite email. The button is labelled
"Login with Netlify Identity" only because that's the service running it behind the
scenes; teachers never see netlify.com.

- **Edit a page** — pick a unit in the left sidebar, pick a page, edit, click Publish.
- **Add a page** — "New page". Set *Sits under* to slot it beneath an existing page
  (leave empty for a top-level page in that unit), and *Position* to order it among
  its siblings — lower numbers first.
- **Images and files** — drag them into the editor; they're uploaded to `assets/`.
- **Videos** — paste the YouTube link on a line of its own and it becomes a video.
  (The "+" button → *YouTube video* still works if you prefer.) A link you gave your
  own words to, like "[Watch this](…)", stays a link — only a bare link becomes a video.

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
npx --yes serve          # then open the URL it prints
```

Any static server will do, but on Windows `python` is usually a Microsoft Store stub
that prints "Python was not found" and exits without serving anything — use `py -m
http.server 8000` there, or just `npx serve`, since Node is already required for the build.

`content.json` is generated and git-ignored — build it before serving. `app.js` fetches
it, so opening `index.html` off disk will not work.

```sh
node test.js             # checks the Markdown -> block compiler
```

## Deployment

Netlify free tier, wired to this repo: `netlify.toml` runs `node build.js` on every
push, including the pushes the CMS makes. No dependencies to install, nothing to pay
for, no server to run. There is no application server — the public site is static
files, so it cannot be "hacked" in the usual sense and costs nothing to keep up.

Auth is Netlify Identity (invite-only) plus Git Gateway, so editors commit through
Netlify rather than needing GitHub accounts of their own. Enable both in the Netlify
dashboard: **Identity → Enable**, set registration to *Invite only*, then
**Services → Git Gateway → Enable**.

### Who can do what

The public site is static files — readable by anyone, which is the point. Editing is
gated at the *commit* layer, not the page layer:

| | can open the page | can change content |
|---|---|---|
| `/` | anyone | — |
| `/admin` | anyone (just a login form) | only an invited Identity user |
| `/admin/demo.html` | anyone | nobody — in-memory copy, no write path |

`/admin` being publicly loadable is expected and fine: without a valid Identity token
Git Gateway rejects every write, so an anonymous visitor gets a login box and nothing
more. Two dashboard settings are what actually enforce this — check both:

1. **Identity → Registration → `Invite only`.** If this is ever `Open`, anyone on the
   internet can self-register and edit the site. This is the setting that matters.
2. **Identity → Services → Git Gateway → Roles**: set a role (e.g. `editor`) and give
   each teacher that role. Then a self-registered account still can't commit.

### Production checklist

- [ ] Custom domain: Netlify **Domain management → Add a domain**. HTTPS is automatic.
      A real domain is the single biggest win for "easy to find".
- [ ] Identity registration set to *Invite only* (above).
- [ ] Git Gateway restricted to a role (above).
- [ ] Every teacher invited, **including your own email** — a Netlify account is not
      an Identity user.
- [ ] Confirm the deploy actually builds: `curl -sI https://YOUR-SITE/content.json`
      should be `200`. `content.json` is generated, not committed, so a deploy that
      skipped `node build.js` serves a 404 page and the site shows "Could not load
      content".

### Known limits

**Git Gateway is deprecated.** Netlify still runs it and still patches security holes
in it, but no longer fixes functional bugs, and Netlify Identity itself was slated for
removal before that decision was [reversed in February 2026][identity]. Nothing is
breaking today and there is no migration to do now — but if Git Gateway is eventually
retired, the fix is to point `admin/config.yml` at the `github` backend (or swap Decap
for Sveltia CMS, which reads the same config). The cost of that day is that teachers
would each need a free GitHub account. The content in `content/` is unaffected either
way — it's just Markdown in Git.

**Search engines only see the home page.** The site is hash-routed (`/#/slug`), so
crawlers index one URL. Fixing that means real paths plus a Netlify redirect, which is
a bigger change than it sounds — not worth it unless search traffic matters.

[identity]: https://answers.netlify.com/t/netlify-identity-is-staying-feb-2026-reversal-what-changed-whos-affected-and-how-to-proceed/162733

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
