# MerQato investor site — Editable Admin

Full responsive investor landing page, with a server-backed editor. Edit sections, portfolio cards, text, links, icons, colors, fonts, header/footer, images and videos. The footer contains **Edit Site**, which opens `/admin`.

## Media library

The **Media library** admin tab accepts multiple files from your device and lets you target the header, any page section, or an individual portfolio/card element. Images: PNG/JPEG/WebP/GIF, maximum 10 MB per file. Videos: MP4/WebM/MOV, maximum 100 MB per file; MP4/WebM recommended for cross-browser playback. Media items can be replaced, reordered, given alt/description text, or removed from the page. Press **Save & Publish** for persistent changes.

## Partner workspace

Open `/workspace` (linked from the site editor toolbar). It is a private area for David and Lawrence — nothing in it is public, and no domain or public deploy is configured yet.

- **Projects:** each project gets its own page at `/p/<slug>`, with headline, description, cover image, tags, status and internal notes. Editing a project updates that page.
- **Ideas, comments and files:** idea board with statuses, threaded-by-scope comments with image/URL attachments, and a file library for brand guidelines, logos and reference files (PDF, DOCX, ZIP, TXT, CSV, images and video).
- **Brand kit:** editable brand name, tagline, colours, fonts, logo and written guidelines. The colours and fonts style the generated project pages.
- **Quick links:** URLs with optional username, notes and a password. Passwords are encrypted with AES-256-GCM using a key derived from `ADMIN_PASSWORD` (a local-only key in preview mode), are never returned in the link list, and are revealed only through an explicit authenticated request. Do not paste real credentials into chat or commits.

Workspace data lives in `data/workspace.json` with a random salt in `data/workspace.salt`. Both are gitignored; keep them together and back them up. In production set a strong `ADMIN_PASSWORD` before adding passwords, and put `/admin` and `/workspace` behind Cloudflare Access.

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
