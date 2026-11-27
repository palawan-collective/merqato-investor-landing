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
- **Ideas, comments and files:** idea board with statuses, threaded-by-scope comments with image/URL attachments, and a file library for brand guidelines, logos and reference files (PDF, DOCX, ZIP, TXT, CSV, images and video).
- **Brand kit:** editable brand name, tagline, colours, fonts, logo and written guidelines. The colours and fonts style the generated project pages.
- **Quick links:** URLs with optional username, notes and a password. Passwords are encrypted with AES-256-GCM using a key derived from `ADMIN_PASSWORD` (a local-only key in preview mode), are never returned in the link list, and are revealed only through an explicit authenticated request. Do not paste real credentials into chat or commits.

Workspace data lives in `data/workspace.json` with a random salt in `data/workspace.salt`. Both are gitignored; keep them together and back them up. In production set a strong `ADMIN_PASSWORD` before adding passwords, and put `/admin` and `/workspace` behind Cloudflare Access.

## Media limits on the workstation

Uploads go through `POST /api/upload` and are written to `uploads/`. Images: PNG/JPEG/WebP/GIF up to 10 MB each. Video: MP4/WebM/MOV up to 100 MB each. Multiple files can be selected at once when creating or editing a project and when posting a discussion update. Files are content-checked against their declared type, and only `/uploads/…` paths or `http(s)` URLs are accepted for links and media, so pasted `javascript:` payloads are dropped.

## Run

Requires Node.js 20+ and no npm dependencies.

Local admin demo without a login screen (for a **trusted local environment only**):

```bash
MQ_LOCAL_PREVIEW=1 node server.js
```

Production:

```bash
ADMIN_PASSWORD='a-long-unique-secret' NODE_ENV=production node server.js
```

Open `/` for the site and `/admin` for the editor. On public deployments, restrict `/admin` via Cloudflare Access; do not enable `MQ_LOCAL_PREVIEW` in production. The project keeps password protection for the public backend to prevent arbitrary visitors changing content. Never share the admin password.

## Coolify

Deploy as a Node service on port 3000, set the above environment variables, and mount persistent volumes for `/app/data` and `/app/uploads`. Both directories must survive deploys. Back up both volumes securely. The storage backend is a local disk; if media traffic grows, migrate files to R2 or another object store.

## Notes

Saved HTML is stored in `data/site.json` and the previous version in `data/site.backup.json`. Uploaded files live in `uploads/`. Removing media from the *page* does not immediately purge unused files from disk; storage cleanup can be managed separately. The editor is for trusted administrators and not a public multi-user CMS. Avoid deleting sections required for the interactive calculator.
