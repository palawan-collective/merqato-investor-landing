'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function createWorkspace(ROOT) {
  const DIR = path.join(ROOT, 'data');
  const DATA = path.join(DIR, 'workspace.json');
  const SALT_FILE = path.join(DIR, 'workspace.salt');
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(SALT_FILE)) fs.writeFileSync(SALT_FILE, crypto.randomBytes(32), { flag: 'wx' });
  const SALT = fs.readFileSync(SALT_FILE);
  const KEY = crypto.scryptSync(process.env.ADMIN_PASSWORD || 'mq-local-preview-only', SALT, 32);

  const defaults = () => ({
    brand: {
      name: 'MerQato Digital', tagline: 'Built in Palawan. Working everywhere.',
      primary: '#111111', accent: '#D6001C', paper: '#EDE7D9', ink: '#111111',
      fonts: { display: 'Anton', body: 'Inter' }, logo: '',
      guidelines: 'Voice: plain, direct, useful. No hype. Show proof before claims.\n\nDo: name the outcome, show the work, keep sentences short.\nDon\'t: use purple gradients, stock-office photography, or unexplained jargon.',
      updated: ''
    },
    projects: [], ideas: [], files: [], links: [], comments: [], updated: ''
  });

  const load = () => {
    try {
      const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      return { ...defaults(), ...d, brand: { ...defaults().brand, ...(d.brand || {}) } };
    } catch { return defaults(); }
  };

  const save = (data) => {
    data.updated = new Date().toISOString();
    fs.writeFileSync(DATA + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(DATA + '.tmp', DATA);
  };

  const encrypt = (plain) => {
    if (!plain) return null;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  };

  const decrypt = (entry) => {
    if (!entry || !entry.data) return '';
    const c = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(entry.iv, 'base64'));
    c.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([c.update(Buffer.from(entry.data, 'base64')), c.final()]).toString('utf8');
  };

  const safeLink = (l) => {
    const { secret, ...rest } = l;
    return { ...rest, hasPassword: !!secret };
  };

  const publicState = (d) => ({ ...d, links: (d.links || []).map(safeLink) });

  const cleanColor = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : fallback);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const renderProject = (slug) => {
    const d = load();
    const p = (d.projects || []).find(x => x.slug === slug);
    if (!p) return null;
    const b = d.brand || {};
    const accent = cleanColor(b.accent, '#D6001C');
    const primary = cleanColor(b.primary, '#111111');
    const paper = cleanColor(b.paper, '#EDE7D9');
    const img = /^\/uploads\/[A-Za-z0-9._-]+$/.test(p.image || '') ? p.image : '';
    const cta = /^https?:\/\/[^\s"']+$/.test(p.url || '') ? p.url : '';
    const tags = (p.tags || []).slice(0, 8).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(p.name)} — ${esc(b.name || 'MerQato')}</title>
<style>
:root{--accent:${accent};--primary:${primary};--paper:${paper}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--primary);font:16px/1.6 Inter,Arial,sans-serif}
.wrap{width:min(100% - 36px,1120px);margin:0 auto}
header{padding:22px 0;border-bottom:1px solid rgba(0,0,0,.18);display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:900;letter-spacing:-.05em;font-size:22px}.brand i{color:var(--accent);font-style:normal}
.status{font:700 11px Inter,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;border:1px solid currentColor;padding:6px 10px;border-radius:99px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:70px 0 60px}
.eyebrow{font:700 11px Inter,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(46px,7vw,92px);line-height:1.02;letter-spacing:-.04em;margin:14px 0 20px;font-family:${esc(b.fonts?.display || 'Anton')},Impact,sans-serif;font-weight:400}
p.lead{font-size:19px;max-width:60ch;margin:0 0 22px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}.tag{font:700 11px Inter,Arial,sans-serif;border:1px solid currentColor;padding:5px 10px;border-radius:99px;opacity:.8}
a.button{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:4px}
figure{margin:0}figure img{width:100%;height:auto;display:block;border-radius:6px;background:rgba(0,0,0,.06);aspect-ratio:4/5;object-fit:cover}
section{border-top:1px solid rgba(0,0,0,.18);padding:42px 0}h2{font-size:clamp(28px,4vw,44px);letter-spacing:-.03em;margin:0 0 18px}
.notes{white-space:pre-wrap;max-width:72ch}footer{padding:30px 0 60px;font-size:13px;opacity:.7}
@media(max-width:760px){.hero{grid-template-columns:1fr;gap:28px;padding:44px 0}figure img{aspect-ratio:16/10}}
</style></head><body><div class="wrap">
<header><div class="brand">${esc(b.name || 'MerQato')}<i>.</i></div><div class="status">${esc(p.status || 'In progress')}</div></header>
<div class="hero"><div><div class="eyebrow">${esc(p.client || 'MerQato Digital')} · project brief</div>
<h1>${esc(p.headline || p.name)}</h1>
<p class="lead">${esc(p.description || 'Project details are being prepared.')}</p>
<div class="tags">${tags}</div>
${cta ? `<a class="button" href="${cta}" target="_blank" rel="noopener noreferrer">Open project ↗</a>` : ''}
</div><figure>${img ? `<img src="${img}" alt="${esc(p.name)}">` : ''}</figure></div>
<section><h2>What we're doing</h2><div class="notes">${esc(p.notes || p.description || '')}</div></section>
<footer>${esc(b.tagline || '')} · Private project brief</footer></div></body></html>`;
  };

  return { load, save, encrypt, decrypt, publicState, renderProject, DATA };
};
