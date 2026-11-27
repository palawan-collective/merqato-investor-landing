# MerQato investor site — Editable Admin

Full responsive investor landing page, with a server-backed editor. Edit sections, portfolio cards, text, links, icons, colors, fonts, header/footer, images and videos. The footer contains **Edit Site**, which opens `/admin`.

## Media library

The **Media library** admin tab accepts multiple files from your device and lets you target the header, any page section, or an individual portfolio/card element. Images: PNG/JPEG/WebP/GIF, maximum 10 MB per file. Videos: MP4/WebM/MOV, maximum 100 MB per file; MP4/WebM recommended for cross-browser playback. Media items can be replaced, reordered, given alt/description text, or removed from the page. Press **Save & Publish** for persistent changes.

## Partner workspace

Open `/admin` — it redirects to the partner workstation at `/workspace`; the public-site editor is now secondary at `/admin/edit`. Data lives in gitignored `data/workspace.json` and `data/workspace.salt`.

- **Projects and project folders:** each project gets a working folder inside `/workspace` (Projects → **Open folder**) and a shareable page at `/p/<slug>`. A project carries name, client, status, **priority** (Low/Medium/High/Urgent), target date, headline, description, internal notes, tags and a cover image.
- **Project tool links:** add as many links as a project needs — GitHub repo, Vercel preview/production, Figma, docs, or any other relevant URL. Each link has a type, an optional label and a URL; the type is guessed from the URL when you paste one.
- **Images and video per project:** upload multiple screenshots of the site, photos from your device, or a video (MP4/WebM/MOV, up to 100 MB), or paste an image/video URL. Media is attached to that project only, shown in a gallery in the folder, and on the public project page. A saved image can also be used as the project cover.
- **Partner discussion per folder:** every project folder has a Discussion tab. Comments show who wrote them, the **date raised**, the **priority**, any image/video attachments, and a **Mark complete** action that stamps the completion date and author. Completed items move to a green "Completed" list and can be reopened. The same thread is rendered, read-only, on `/p/<slug>` so partners see exactly what was raised, when, and what is done. Comment status and priority are changed through `POST /api/workspace/comment/status` so both partners always see the latest state after a refresh.
- **Ideas:** a full idea workspace, not just a title box. Each idea has title, one-line summary, the full write-up (problem, who pays, how it works, what is missing, first steps), category (Business / Automation / AI agent / Website / Product / Content), stage (Spark / Research / Validating / Building / Parked), priority, owner, effort and potential value, tags, **any number of links** (Google Drive, Docs, Sheets, Figma, GitHub, Vercel, video or any URL) and **multiple images or video from your device**. Ideas appear as visual cards on the idea board with category filters, and each opens its own page with Overview, Links, Visuals and Discussion tabs.
- **Comments and files:** every project and every idea has its own dated discussion thread with priority, image/video attachments and completion stamps; plus a file library for brand guidelines, logos and reference files (PDF, DOCX, ZIP, TXT, CSV, images and video).
- **Brand kit:** editable brand name, tagline, colours, fonts, logo and written guidelines. The colours and fonts style the generated project pages.
- **Quick links:** URLs with optional username, notes and a password. Saved link passwords are encrypted at rest with AES-256-GCM and are never returned in the link list; they are revealed only through an explicit request. This is unrelated to logging in — the workstation itself needs no password. Do not paste real credentials into chat or commits.

Workspace data lives in `data/workspace.json` with a random salt in `data/workspace.salt`. Both are gitignored; keep them together and back them up. Put the site behind Cloudflare Access if it should not be public; no app password is needed.

## Media limits on the workstation

Uploads go through `POST /api/upload` and are written to `uploads/`. Images: PNG/JPEG/WebP/GIF up to 10 MB each. Video: MP4/WebM/MOV up to 100 MB each. Multiple files can be selected at once when creating or editing a project and when posting a discussion update. Files are content-checked against their declared type, and only `/uploads/…` paths or `http(s)` URLs are accepted for links and media, so pasted `javascript:` payloads are dropped.

## Run

Requires Node.js 20+ and no npm dependencies. **Nothing to configure.**

```bash
node server.js
```

That starts the whole thing on port 3000:

| Path | What it is |
| --- | --- |
| `/` | the investor landing page |
| `/workspace` | the partner workstation (open by default) |
| `/p/<slug>` | a project folder page |
| `/admin/edit` | the secondary page editor |
| `/health` | health check + build marker for Coolify |

### No login. Nothing to configure.

There is no login screen, no password, and no build step — on `/workspace` or on `/admin/edit`. That is intentional while the site is being built. If you want it private later, put Cloudflare Access in front of the domain; do not add a password to the app.

## Office agent

`/workspace` has an **Office agent** tab, and its briefing also appears on the dashboard. It reads the workspace and reports:

- what was **done yesterday** (completed items) and what was said but not closed
- **plan for today**: overdue deadlines first, then work due within 7 days, then urgent open items
- **deadlines** with day counts, **gone quiet** projects (10+ days without activity) and ideas (14+ days)
- **tidy-up**: projects with no images, no links or no description; ideas with no links or thinking written down
- **opportunities**: launched work worth writing up, high-priority ideas awaiting a decision, Drive links worth consolidating

It runs in two modes:

| Mode | Requirement | Behaviour |
| --- | --- | --- |
| Local | none | Deterministic analysis, no network, never invents facts |
| OpenRouter | `OPENROUTER_API_KEY` | A free model rewrites the analysis as a ~120-word briefing |

Set the key in Coolify under environment variables:

```bash
OPENROUTER_API_KEY=sk-or-v1-...        # from openrouter.ai/keys, free tier is fine
OPENROUTER_MODEL=google/gemma-4-31b-it:free   # optional, must end in :free
```

Without a key the agent still works, labelled "Local analysis". If the key is wrong or the model is rate-limited, the API returns the local text with `aiError` noted — the page never breaks and the agent never invents a fact. Responses are cached for 15 minutes per workspace revision, and **Run again** forces a fresh call.

Free models rate-limit aggressively. If the AI text stops appearing, that is the free tier, not a bug; the local briefing keeps working.

Free model names get retired constantly — that is why the agent does not trust its own list. It tries the preferred models first, then asks OpenRouter which free text models exist right now and tries those. If the diagnostics line says `HTTP 404` for one model but the briefing still appears, the fallback worked; you never need to edit code because a model was renamed.

## Coolify

Deploy as a Node service on port 3000. No environment variables are required. The health check path is `/health`.

Mount persistent volumes for `/app/data` and `/app/uploads`, otherwise saved projects and uploaded images disappear on every redeploy — that alone looks like "nothing changed". Back up both volumes. Storage is local disk; if media traffic grows, move files to R2 or another object store.

### "I deployed and nothing changed"

Check in this order. Each step rules out one cause, so do not skip ahead.

1. **Is the new code on the server?** Open `https://lawrence.merqato.digital/health?cb=1`. It returns `build`, `started` and `cwd`.
   - `build` is the newest marker and `started` is recent → the deploy worked. The problem is a cache, go to step 2.
   - `build` is old → the container was never replaced. Coolify → your app → **Deploy** (not *Redeploy*), then wait for green.
   - It 404s → Coolify is not running this container at all. Confirm the container logs end with `MerQato site + admin at http://localhost:3000`, and that the app's build pack is set to the Dockerfile.

2. **Is a cache involved?** This app now sends `cache-control: no-store, no-cache, must-revalidate` plus `pragma: no-cache` on every page, so browsers, Cloudflare and any proxy must re-check on every request. If you still see old HTML after step 1 passed, it is almost always one of:
   - Cloudflare **Caching → Cache Rules** with a rule that overrides origin headers (an "Ignore origin cache-control" / Edge Cache TTL setting).
   - A Cloudflare **Page Rule** or the **Always Online** feature serving a stored copy.
   - A Coolify/Nginx proxy cache in front of the container.
   To prove which: load the site on mobile data with a query string like `/?cb=2`. If that shows the new page, the origin is fine and the cache is in front.

3. **Still stuck?** Open `/workspace` and read the small grey line at the bottom-left of the sidebar. `build 2026-11-27-v8` means new code; `build unversioned` means old code is still being served.

## Page editing: saved as a diff, not a copy

The page editor (`/admin/edit`) does **not** store a copy of the page. It compares the preview
with the page it was loaded from and saves only what changed — a sentence replaced, a link
changed, a colour added, a card deleted — into `data/site.json` as `patches`.

This matters because of how the old editor worked. It saved a full clone of `<main>` and `<nav>`,
and the server pasted that clone over `index.html` on every request. Any later change to
`index.html` — a footer button, a mobile fix — was therefore invisible: the server was running
new code but serving old markup. That is what "I deployed and nothing changed" looked like.

Patch paths look like `section:1>div:0>h2:0`: tag name, colon, position among same-tag siblings.
They survive edits elsewhere on the page.

### If you see a black banner at the bottom of the site

It means `data/site.json` still holds a save from the old editor. The banner names the date and
tells you what to do: open the workstation → *Edit site design* → press **Save** once. That
converts the file to patches and the banner disappears. The old save is also copied to
`data/site.backup.json` before anything is overwritten, so nothing is lost.

### Round-trip test

`node test/page-patches.test.js` runs 21 checks against the patch engine, including the case that
started all this: the Admin button in the footer must survive an unrelated text edit.

## Notes

Saved HTML is stored in `data/site.json` and the previous version in `data/site.backup.json`. Uploaded files live in `uploads/`. Removing media from the *page* does not immediately purge unused files from disk; storage cleanup can be managed separately. The editor is for trusted administrators and not a public multi-user CMS. Avoid deleting sections required for the interactive calculator.
