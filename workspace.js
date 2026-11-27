'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function createWorkspace(ROOT) {
  const DIR = path.join(ROOT, 'data');
  const DATA = path.join(DIR, 'workspace.json');
  const SALT_FILE = path.join(DIR, 'workspace.salt');
  // Serverless hosts (Vercel) ship a read-only bundle: never crash on mkdir, and
  // fall back to an in-memory salt so links still encrypt within a warm instance.
  let writable = true;
  let salt = null;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(SALT_FILE)) fs.writeFileSync(SALT_FILE, crypto.randomBytes(32), { flag: 'wx' });
    salt = fs.readFileSync(SALT_FILE);
  } catch {
    writable = false;
    salt = process.env.WORKSPACE_SALT ? Buffer.from(process.env.WORKSPACE_SALT, 'utf8') : crypto.createHash('sha256').update('readonly-' + (process.env.ADMIN_PASSWORD || 'no-password')).digest();
  }
  const SALT = salt;
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
    if (Array.isArray(data.projects)) data.projects = cleanProjects(data.projects);
    if (Array.isArray(data.comments)) data.comments = cleanComments(data.comments);
    if (Array.isArray(data.ideas)) data.ideas = cleanIdeas(data.ideas);
    data.updated = new Date().toISOString();
    if (!writable) return; // read-only host: keep serving, skip persistence
    try {
      fs.writeFileSync(DATA + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(DATA + '.tmp', DATA);
    } catch (err) {
      writable = false;
      console.warn('Workspace is running without a writable disk:', err.message);
    }
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

  const publicState = (d) => {
    const out = { ...d, links: (d.links || []).map(safeLink) };
    out.projects = cleanProjects(d.projects);
    out.comments = cleanComments(d.comments);
    // Project-scoped discussion is already mirrored in comments; keep folders self-contained too.
    out.projects = out.projects.map(p => ({ ...p, thread: out.comments.filter(c => c.scope.type === 'project' && c.scope.id === p.id) }));
    out.ideas = cleanIdeas(d.ideas).map(i => ({ ...i, thread: out.comments.filter(c => c.scope.type === 'idea' && c.scope.id === i.id) }));
    return out;
  };

  const cleanColor = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : fallback);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- project folder primitives ----------
  const LINK_KINDS = ['github', 'vercel', 'figma', 'docs', 'drive', 'sheet', 'preview', 'video', 'other'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
  const isUploaded = (v) => /^\/uploads\/[A-Za-z0-9._-]+$/.test(String(v || ''));
  const isHttpUrl = (v) => /^https?:\/\/[^\s"'<>\\]+$/i.test(String(v || ''));
  const safeUrl = (v) => (isHttpUrl(v) ? String(v).slice(0, 2000) : isUploaded(v) ? String(v) : '');
  const cleanPriority = (v) => (PRIORITIES.includes(v) ? v : 'Medium');
  const cleanKind = (v) => (LINK_KINDS.includes(v) ? v : 'other');
  const text = (v, max) => String(v == null ? '' : v).slice(0, max);
  const stamp = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');

  // Project links: any number of GitHub, Vercel or other relevant URLs.
  const cleanProjectLinks = (arr, p) => {
    const out = (Array.isArray(arr) ? arr : []).slice(0, 25).map((l, i) => ({
      id: text(l && l.id, 40) || `link-${i}`,
      label: text(l && (l.label || l.title), 80),
      url: safeUrl(l && l.url),
      kind: cleanKind(l && l.kind)
    })).filter(l => l.url);
    // Fold the legacy single project URL into the list so nothing is lost.
    const old = safeUrl(p && p.url);
    if (old && !out.some(l => l.url === old)) out.unshift({ id: 'link-legacy', label: 'Project URL', url: old, kind: 'other' });
    return out;
  };

  // Project media: screenshots/images from the site or device, plus device video.
  const cleanProjectMedia = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 60).map((m, i) => {
    const url = safeUrl(m && m.url);
    return {
      id: text(m && m.id, 40) || `media-${i}`,
      url,
      type: /^video\//i.test(m && (m.type || '')) || /\.(mp4|webm|mov)$/i.test(url) ? 'video' : 'image',
      name: text(m && m.name, 140),
      title: text(m && m.title, 160),
      created: stamp(m && m.created) || new Date().toISOString()
    };
  }).filter(m => m.url);

  const cleanProjectOptions = (p) => ({
    priority: cleanPriority(p.priority),
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(p.due || '')) ? p.due : '',
    repo: safeUrl(p.repo)
  });

  // Normalise a whole project record so unauthenticated renders stay safe.
  const cleanProject = (p) => {
    if (!p || typeof p !== 'object') return null;
    const name = text(p.name, 160);
    if (!name) return null;
    const { thread, ...rest } = p;
    return {
      ...rest,
      name,
      slug: text(p.slug, 80).replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'project',
      client: text(p.client, 120),
      status: text(p.status, 40) || 'In progress',
      headline: text(p.headline, 220),
      description: text(p.description, 4000),
      notes: text(p.notes, 8000),
      tags: (Array.isArray(p.tags) ? p.tags : []).slice(0, 12).map(t => text(t, 40)).filter(Boolean),
      image: isUploaded(p.image) || isHttpUrl(p.image) ? String(p.image) : '',
      url: safeUrl(p.url),
      ...cleanProjectOptions(p),
      links: cleanProjectLinks(p.links, p),
      media: cleanProjectMedia(p.media),
      created: stamp(p.created) || new Date().toISOString()
    };
  };

  function cleanProjects(arr) { return (Array.isArray(arr) ? arr : []).map(cleanProject).filter(Boolean); }

  // Ideas are light-weight project proposals: same media/link/discussion shape.
  const cleanIdea = (i) => {
    if (!i || typeof i !== 'object') return null;
    const title = text(i.title, 200);
    if (!title.trim()) return null;
    const notes = text(i.description, 8000);
    return {
      id: text(i.id, 40) || crypto.randomBytes(6).toString('hex'),
      title,
      description: text(i.description, 4000),
      notes,
      pitch: text(i.pitch, 4000),
      category: text(i.category, 60) || 'Other',
      stage: ['Spark', 'Research', 'Validating', 'Building', 'Parked'].includes(i.stage) ? i.stage : (['New', 'Review', 'Building', 'Parked'].includes(i.status) ? 'Spark' : 'Spark'),
      status: ['New', 'Review', 'Building', 'Parked'].includes(i.status) ? i.status : 'New',
      priority: cleanPriority(i.priority),
      owner: text(i.owner, 60),
      effort: text(i.effort, 40),
      value: text(i.value, 40),
      tags: (Array.isArray(i.tags) ? i.tags : []).slice(0, 12).map(t => text(t, 40)).filter(Boolean),
      links: cleanProjectLinks(i.links, i),
      media: cleanProjectMedia(i.media),
      created: stamp(i.created) || new Date().toISOString(),
      updated: stamp(i.updated) || ''
    };
  };
  function cleanIdeas(arr) { return (Array.isArray(arr) ? arr : []).map(cleanIdea).filter(Boolean); }

  // Discussion entries on a project: dated, prioritised and completable.
  const cleanComment = (c) => {
    if (!c || typeof c !== 'object') return null;
    const body = text(c.text, 4000);
    if (!body.trim()) return null;
    const done = c.done === true || c.done === 'true';
    return {
      id: text(c.id, 40) || crypto.randomBytes(6).toString('hex'),
      scope: c.scope && typeof c.scope === 'object' ? { type: text(c.scope.type, 20) || 'general', id: text(c.scope.id, 60) } : { type: 'general', id: '' },
      author: text(c.author, 60) || 'Partner',
      text: body,
      url: safeUrl(c.url),
      image: isUploaded(c.image) || isHttpUrl(c.image) ? String(c.image) : '',
      attachments: (Array.isArray(c.attachments) ? c.attachments : []).slice(0, 10).map((a, i) => ({
        id: text(a && a.id, 40) || `att-${i}`,
        url: safeUrl(a && a.url),
        type: /^video\//i.test(a && (a.type || '')) ? 'video' : 'image',
        name: text(a && a.name, 140)
      })).filter(a => a.url),
      priority: cleanPriority(c.priority),
      done,
      created: stamp(c.created) || new Date().toISOString(),
      completedAt: done ? (stamp(c.completedAt) || new Date().toISOString()) : '',
      completedBy: done ? text(c.completedBy, 60) : ''
    };
  };

  function cleanComments(arr) { return (Array.isArray(arr) ? arr : []).map(cleanComment).filter(Boolean).slice(0, 400); }

  const KIND_LABEL = { github: 'GitHub', vercel: 'Vercel', figma: 'Figma', docs: 'Docs', drive: 'Drive', sheet: 'Sheet', video: 'Video', preview: 'Preview', other: 'Link' };

  const renderProject = (slug) => {
    const d = load();
    const found = (d.projects || []).find(x => x.slug === slug);
    if (!found) return null;
    const p = cleanProject(found);
    if (!p) return null;
    const b = d.brand || {};
    const accent = cleanColor(b.accent, '#D6001C');
    const primary = cleanColor(b.primary, '#111111');
    const paper = cleanColor(b.paper, '#EDE7D9');
    const img = p.image || '';
    const cover = p.media.filter(m => m.type === 'image')[0];
    const heroImg = img || (cover ? cover.url : '');
    const tags = p.tags.slice(0, 8).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const thread = cleanComments((d.comments || []).filter(c => c.scope.type === 'project' && c.scope.id === found.id));
    const open = thread.filter(c => !c.done);
    const closed = thread.filter(c => c.done);
    const pClass = (v) => `prio-${String(v || 'medium').toLowerCase()}`;
    const when = (iso) => {
      if (!iso) return '';
      const dt = new Date(iso);
      return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    };
    const linkCards = p.links.map(l => `<a class="tool" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
<span class="toolkind">${esc(KIND_LABEL[l.kind] || 'Link')}</span>
<strong>${esc(l.label || l.url.replace(/^https?:\/\//, '').slice(0, 48))}</strong>
<span class="toolurl">${esc(l.url.replace(/^https?:\/\//, '').slice(0, 72))}</span></a>`).join('');
    const gallery = p.media.map((m, i) => m.type === 'video'
      ? `<figure class="shot"><video src="${esc(m.url)}" controls preload="metadata" playsinline></video><figcaption>${esc(m.title || m.name || 'Video ' + (i + 1))}</figcaption></figure>`
      : `<figure class="shot"><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(m.url)}" alt="${esc(m.title || m.name || p.name + ' image ' + (i + 1))}" loading="lazy"></a><figcaption>${esc(m.title || m.name || 'Image ' + (i + 1))}</figcaption></figure>`).join('');
    const entry = (c, done) => `<li class="entry${done ? ' done' : ''}">
<div class="entryhead"><span class="who">${esc(c.author)}</span>
<span class="prio ${pClass(c.priority)}">${esc(c.priority)}</span>
<span class="when">${done ? 'Completed ' + esc(when(c.completedAt)) : 'Raised ' + esc(when(c.created))}</span></div>
<div class="entrybody">${esc(c.text)}</div>
${c.attachments.length ? `<div class="att">${c.attachments.map(a => a.type === 'video'
  ? `<video src="${esc(a.url)}" controls preload="metadata" playsinline></video>`
  : `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(a.url)}" alt="${esc(a.name || 'Attachment')}" loading="lazy"></a>`).join('')}</div>` : ''}
${c.url ? `<a class="inline" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)} ↗</a>` : ''}
${done ? '' : `<div class="markdone">${esc(c.author)} · open — mark complete in the workstation</div>`}</li>`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="robots" content="noindex,nofollow"><title>${esc(p.name)} — ${esc(b.name || 'MerQato')}</title>
<style>
:root{--accent:${accent};--primary:${primary};--paper:${paper}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--primary);font:16px/1.6 Inter,Arial,sans-serif}
.wrap{width:min(100% - 36px,1120px);margin:0 auto}
header{padding:22px 0;border-bottom:1px solid rgba(0,0,0,.18);display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:900;letter-spacing:-.05em;font-size:22px;color:inherit;text-decoration:none}.brand i{color:var(--accent);font-style:normal}
.status{font:700 11px Inter,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;border:1px solid currentColor;padding:6px 10px;border-radius:99px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:70px 0 60px}
.eyebrow{font:700 11px Inter,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(46px,7vw,92px);line-height:1.02;letter-spacing:-.04em;margin:14px 0 20px;font-family:${esc(b.fonts?.display || 'Anton')},Impact,sans-serif;font-weight:400}
p.lead{font-size:19px;max-width:60ch;margin:0 0 22px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}.tag{font:700 11px Inter,Arial,sans-serif;border:1px solid currentColor;padding:5px 10px;border-radius:99px;opacity:.8}
a.button{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:4px}
figure{margin:0}figure img{width:100%;height:auto;display:block;border-radius:6px;background:rgba(0,0,0,.06)}
.cover{aspect-ratio:4/5;object-fit:cover}
section{border-top:1px solid rgba(0,0,0,.18);padding:42px 0}h2{font-size:clamp(28px,4vw,44px);letter-spacing:-.03em;margin:0 0 18px}
h3.sub{font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.65;margin:0 0 12px}
.notes{white-space:pre-wrap;max-width:72ch}footer{padding:30px 0 60px;font-size:13px;opacity:.7}
.tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.tool{display:block;border:1px solid rgba(0,0,0,.2);border-radius:8px;padding:13px 15px;text-decoration:none;color:inherit;background:rgba(255,255,255,.45)}
.tool:hover{border-color:var(--accent);color:var(--accent)}
.toolkind{display:block;font:700 10px Inter,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:5px}
.tool strong{display:block;font-size:15px;overflow-wrap:anywhere}
.toolurl{display:block;font-size:12px;opacity:.6;overflow-wrap:anywhere}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.shot{border:1px solid rgba(0,0,0,.14);border-radius:8px;overflow:hidden;background:rgba(0,0,0,.05)}
.shot img,.shot video{width:100%;height:100%;max-height:300px;object-fit:cover;display:block}
.shot figcaption{font-size:12px;padding:7px 9px;opacity:.7;overflow-wrap:anywhere}
.thread{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.entry{border:1px solid rgba(0,0,0,.16);border-left:4px solid var(--accent);border-radius:8px;padding:13px 15px;background:rgba(255,255,255,.45)}
.entry.done{border-left-color:#177a4f;opacity:.72}
.entryhead{display:flex;gap:9px;flex-wrap:wrap;align-items:center;font-size:12px;margin-bottom:6px}
.who{font-weight:800}.when{opacity:.65}
.prio{font:800 9px Inter,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;border-radius:99px;padding:3px 8px;border:1px solid currentColor}
.prio.prio-low{color:#5a6b6a}.prio.prio-medium{color:#1f5fa8}.prio.prio-high{color:#b26a00}.prio.prio-urgent{color:#b00020}
.entry.done .prio{color:#177a4f}
.entrybody{white-space:pre-wrap;overflow-wrap:anywhere}
.att{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
.att img,.att video{max-height:150px;max-width:240px;border-radius:6px;border:1px solid rgba(0,0,0,.12);display:block}
a.inline{font-size:13px;color:var(--accent);overflow-wrap:anywhere;word-break:break-word}
.markdone{margin-top:8px;font-size:11px;opacity:.5}
.meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;opacity:.7;margin:0 0 22px}
.meta b{font-weight:800;opacity:.9}
@media(max-width:760px){.hero{grid-template-columns:1fr;gap:28px;padding:44px 0}.cover{aspect-ratio:16/10}}
</style></head><body><div class="wrap">
<header><a class="brand" href="/">${esc(b.name || 'MerQato')}<i>.</i></a>
<span class="status">${esc(p.status)}</span></header>
<div class="hero"><div><div class="eyebrow">${esc(p.client || 'MerQato Digital')} · project folder</div>
<h1>${esc(p.headline || p.name)}</h1>
<p class="lead">${esc(p.description || 'Project details are being prepared.')}</p>
<div class="meta"><span>Priority <b>${esc(p.priority)}</b></span>${p.due ? `<span>Due <b>${esc(p.due)}</b></span>` : ''}<span>Started <b>${esc(when(p.created).slice(0, 10))}</b></span><span><b>${open.length}</b> open · <b>${closed.length}</b> completed</span></div>
<div class="tags">${tags}</div>
${p.links[0] ? `<a class="button" href="${esc(p.links[0].url)}" target="_blank" rel="noopener noreferrer">Open ${esc(KIND_LABEL[p.links[0].kind] || 'project')} ↗</a>` : ''}
</div><figure>${heroImg ? `<img class="cover" src="${esc(heroImg)}" alt="${esc(p.name)}">` : ''}</figure></div>
<section><h2>What we're doing</h2><div class="notes">${esc(p.notes || p.description || '')}</div></section>
${p.links.length ? `<section><h2>Project tools</h2><div class="tools">${linkCards}</div></section>` : ''}
${p.media.length ? `<section><h2>Screens &amp; media</h2><div class="gallery">${gallery}</div></section>` : ''}
<section><h2>Partner discussion</h2>
<h3 class="sub">Open · ${open.length}</h3>
${open.length ? `<ul class="thread">${open.map(c => entry(c, false)).join('')}</ul>` : `<p style="opacity:.6">Nothing open. The thread is clear.</p>`}
${closed.length ? `<h3 class="sub" style="margin-top:30px">Completed · ${closed.length}</h3><ul class="thread">${closed.map(c => entry(c, true)).join('')}</ul>` : ''}
</section>
<footer>${esc(b.tagline || '')} · Private project folder · <a class="inline" href="/workspace">Workstation</a></footer></div></body></html>`;
  };

  return { load, save, encrypt, decrypt, publicState, renderProject, DATA, isWritable: () => writable };
};
