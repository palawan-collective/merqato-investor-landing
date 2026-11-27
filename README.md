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

## Coolify

Deploy as a Node service on port 3000. No environment variables are required. The health check path is `/health`.

Mount persistent volumes for `/app/data` and `/app/uploads`, otherwise saved projects and uploaded images disappear on every redeploy — that alone looks like "nothing changed". Back up both volumes. Storage is local disk; if media traffic grows, move files to R2 or another object store.

If the Coolify app still serves the old page after a deploy, hit `/health` on the live domain. If it 404s or returns an old `build` value, Coolify is not running this container — rebuild it: **Coolify → your app → Deployments → Redeploy**, and confirm the container logs end with `MerQato site + admin at http://localhost:3000`.

## Notes

Saved HTML is stored in `data/site.json` and the previous version in `data/site.backup.json`. Uploaded files live in `uploads/`. Removing media from the *page* does not immediately purge unused files from disk; storage cleanup can be managed separately. The editor is for trusted administrators and not a public multi-user CMS. Avoid deleting sections required for the interactive calculator.
