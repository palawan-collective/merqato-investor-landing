# MerQato investor site — Editable Admin

Full responsive investor landing page, with a server-backed editor. Edit sections, portfolio cards, text, links, icons, colors, fonts, header/footer, images and videos. The footer contains **Edit Site**, which opens `/admin`.

## Media library

The **Media library** admin tab accepts multiple files from your device and lets you target the header, any page section, or an individual portfolio/card element. Images: PNG/JPEG/WebP/GIF, maximum 10 MB per file. Videos: MP4/WebM/MOV, maximum 100 MB per file; MP4/WebM recommended for cross-browser playback. Media items can be replaced, reordered, given alt/description text, or removed from the page. Press **Save & Publish** for persistent changes.

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
