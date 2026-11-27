'use strict';
// MerQato office agent: reads the workspace and reports what happened,
// what is due, what is stuck, and what is worth doing next.
//
// Local mode always works (deterministic analysis, no network).
// If OPENROUTER_API_KEY is set, a free model rewrites that analysis as a
// short briefing. Any failure falls back to the local text silently.

const DAY = 86400000;
const parse = (v) => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? null : d; };
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const todayUTC = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

function analyse(d, now = new Date()) {
  const projects = (d.projects || []).filter(Boolean);
  const ideas = (d.ideas || []).filter(Boolean);
  const comments = (d.comments || []).filter(Boolean);
  const files = (d.files || []).filter(Boolean);
  const links = (d.links || []).filter(Boolean);

  const done = comments.filter((c) => c.done);
  const open = comments.filter((c) => !c.done);
  const yesterday = new Date(now.getTime() - DAY);

  const doneYesterday = done.filter((c) => { const t = parse(c.completedAt); return t && dayKey(t) === dayKey(yesterday); });
  const saidYesterday = comments.filter((c) => { const t = parse(c.created); return t && dayKey(t) === dayKey(yesterday); });

  const overdue = [];
  const dueSoon = [];
  for (const p of projects) {
    if (!p.due || p.status === 'Launched') continue;
    const t = parse(p.due);
    if (!t) continue;
    const days = Math.round((Date.parse(String(p.due).slice(0, 10) + 'T00:00:00Z') - todayUTC(now)) / DAY);
    if (Number.isNaN(days)) continue;
    const row = { name: clean(p.name), due: p.due, status: p.status || '', priority: p.priority || 'Medium', days };
    if (days < 0) overdue.push(row);
    else if (days <= 7) dueSoon.push(row);
  }
  overdue.sort((a, b) => a.days - b.days);
  dueSoon.sort((a, b) => a.days - b.days);

  const lastTouch = new Map();
  for (const c of comments) {
    const t = parse(c.created) || parse(c.completedAt);
    if (!t || !c.scope || !c.scope.id) continue;
    const k = c.scope.type + ':' + c.scope.id;
    if (!lastTouch.has(k) || t > lastTouch.get(k)) lastTouch.set(k, t);
  }
  const stale = [];
  for (const p of projects) {
    if (p.status === 'Launched') continue;
    const t = lastTouch.get('project:' + p.id) || parse(p.created);
    if (!t) continue;
    const days = Math.floor((now - t) / DAY);
    if (days >= 10) stale.push({ name: clean(p.name), days, status: p.status || '' });
  }
  stale.sort((a, b) => b.days - a.days);

  const quietIdeas = [];
  for (const i of ideas) {
    const t = lastTouch.get('idea:' + i.id) || parse(i.created);
    if (!t) continue;
    const days = Math.floor((now - t) / DAY);
    if (days >= 14 && i.stage !== 'Parked') quietIdeas.push({ title: clean(i.title), days, stage: i.stage || 'Spark' });
  }
  quietIdeas.sort((a, b) => b.days - a.days);

  const tidy = [];
  for (const p of projects) {
    if (!(p.media || []).length) tidy.push({ level: 'visual', text: clean(p.name) + ' has no images yet. A screenshot makes the folder readable at a glance.', id: p.id, kind: 'project' });
    if (!(p.links || []).length) tidy.push({ level: 'links', text: clean(p.name) + ' has no repo or live link saved.', id: p.id, kind: 'project' });
    if (!clean(p.description || '') && !clean(p.headline || '')) tidy.push({ level: 'text', text: clean(p.name) + ' has no description, so partners cannot tell what it is.', id: p.id, kind: 'project' });
  }
  for (const i of ideas) {
    if (!(i.links || []).length) tidy.push({ level: 'links', text: 'Idea "' + clean(i.title) + '" has no links. Drop the Drive doc or reference in.', id: i.id, kind: 'idea' });
    if (!clean(i.notes || '')) tidy.push({ level: 'text', text: 'Idea "' + clean(i.title) + '" has only a title. The thinking is not written down yet.', id: i.id, kind: 'idea' });
  }
  for (const l of links) {
    if (!l.url) tidy.push({ level: 'link', text: 'Quick link "' + clean(l.title || 'Untitled') + '" is missing its URL.', id: l.id, kind: 'link' });
  }

  const launched = projects.filter((p) => p.status === 'Launched');
  const opps = [];
  if (launched.length) opps.push(launched.length + ' launched project' + (launched.length === 1 ? '' : 's') + ' (' + launched.map((p) => clean(p.name)).slice(0, 3).join(', ') + '). Each one is a case study and a referral source.');
  const highIdeas = ideas.filter((i) => i.priority === 'High' || i.priority === 'Urgent');
  if (highIdeas.length) opps.push(highIdeas.length + ' high-priority idea' + (highIdeas.length === 1 ? '' : 's') + ' waiting on a decision: ' + highIdeas.slice(0, 3).map((i) => clean(i.title)).join(', ') + '.');
  const driveLinks = [...projects, ...ideas].reduce((n, x) => n + (x.links || []).filter((l) => l.kind === 'drive').length, 0);
  if (driveLinks) opps.push(driveLinks + ' Drive link' + (driveLinks === 1 ? '' : 's') + ' saved. One tidy shared Drive folder would stop partners hunting.');
  if (!files.length) opps.push('The file library is empty. Brand guidelines, logos and a rate card belong there once.');
  const noMedia = projects.filter((p) => !(p.media || []).length).length;
  if (projects.length && noMedia === projects.length) opps.push('No project has a screenshot yet. One image each turns the dashboard into a visual portfolio.');

  const priorities = [];
  for (const p of overdue) priorities.push({ urgency: 'overdue', text: p.name + ' is ' + Math.abs(p.days) + ' day' + (Math.abs(p.days) === 1 ? '' : 's') + ' overdue (due ' + p.due + ').' });
  for (const p of dueSoon) priorities.push({ urgency: 'soon', text: p.name + ' is due ' + (p.days === 0 ? 'today' : 'in ' + p.days + ' day' + (p.days === 1 ? '' : 's')) + ' (' + p.due + ').' });
  const urgentOpen = open.filter((c) => c.priority === 'Urgent' || c.priority === 'High');
  for (const c of urgentOpen.slice(0, 4)) priorities.push({ urgency: 'open', text: clean(c.author || 'Partner') + ': "' + clean(c.text).slice(0, 110) + '"' });

  const parts = [];
  if (doneYesterday.length) parts.push('Yesterday: ' + doneYesterday.slice(0, 3).map((c) => '"' + clean(c.text).slice(0, 80) + '"').join('; ') + ' completed.');
  else if (saidYesterday.length) parts.push('Yesterday there were updates but nothing marked complete: ' + saidYesterday.slice(0, 2).map((c) => '"' + clean(c.text).slice(0, 70) + '"').join('; ') + '.');
  else parts.push('Yesterday had no recorded activity.');
  if (overdue.length) parts.push(overdue.length + ' deadline' + (overdue.length === 1 ? ' is' : 's are') + ' overdue, ' + overdue[0].name + ' first.');
  else if (dueSoon.length) parts.push('Next deadline: ' + dueSoon[0].name + ' ' + (dueSoon[0].days === 0 ? 'today' : 'in ' + dueSoon[0].days + ' day' + (dueSoon[0].days === 1 ? '' : 's')) + '.');
  else parts.push('No deadlines in the next week.');
  if (stale.length) parts.push(stale[0].name + ' has had no update for ' + stale[0].days + ' days.');
  if (tidy.length) parts.push(tidy.length + ' tidy-up item' + (tidy.length === 1 ? '' : 's') + ' would make the workspace clearer.');
  if (open.length) parts.push(open.length + ' open item' + (open.length === 1 ? '' : 's') + ' across partners.');

  return {
    generatedAt: new Date().toISOString(),
    mode: 'local',
    headline: parts.join(' '),
    briefing: parts,
    didYesterday: doneYesterday.map((c) => ({ text: clean(c.text), by: clean(c.completedBy || c.author || 'Partner'), at: c.completedAt })),
    saidYesterday: saidYesterday.map((c) => ({ text: clean(c.text), by: clean(c.author || 'Partner'), at: c.created, priority: c.priority || 'Medium' })),
    planToday: priorities,
    overdue, dueSoon, stale, quietIdeas,
    tidy: tidy.slice(0, 12),
    opportunities: opps.slice(0, 6),
    stats: {
      projects: projects.length,
      building: projects.filter((p) => p.status !== 'Launched' && p.status !== 'On hold').length,
      launched: launched.length,
      ideas: ideas.length,
      openItems: open.length,
      doneItems: done.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length
    }
  };
}

// Free endpoints on OpenRouter get retired and renamed without warning.
// Hardcoding slugs is what broke this once (every model answered HTTP 404 and
// the agent silently fell back to local text). So: keep a small preferred list,
// and if all of them fail, ask OpenRouter itself which free text models exist
// right now and try the best few. No key, no cost, no guessing.
const FREE_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'inclusionai/ling-3.2-flash:free'
];

let freeCache = { at: 0, list: [] };

async function discoverFreeModels() {
  if (Date.now() - freeCache.at < 6 * 3600 * 1000 && freeCache.list.length) return freeCache.list;
  const res = await fetch('https://openrouter.ai/api/v1/models?max_price=0', { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const list = (data && data.data ? data.data : [])
    .filter(m => m && typeof m.id === 'string' && m.id.endsWith(':free'))
    .filter(m => {
      const p = m.pricing || {};
      if (Number(p.prompt) !== 0 || Number(p.completion) !== 0) return false;
      const out = (m.architecture && m.architecture.output_modalities) || ['text'];
      return out.includes('text');
    })
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, 6)
    .map(m => m.id);
  freeCache = { at: Date.now(), list };
  return list;
}

async function askOpenRouter(report, model) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { error: 'no API key configured' };
  const models = [model, ...FREE_MODELS].filter(Boolean);
  const system = 'You are the quiet office agent for a two-person digital studio in Palawan. You receive a factual JSON report about their workspace. Write a short briefing a busy partner can read in 20 seconds. Rules: plain English, no hype, no emoji, never invent facts or names that are not in the JSON, mention overdue work first, then what was done yesterday, then 2 or 3 concrete suggestions. Maximum 120 words. Short sentences.';
  const user = 'Workspace report JSON:\n' + JSON.stringify({
    headline: report.headline, didYesterday: report.didYesterday, saidYesterday: report.saidYesterday,
    planToday: report.planToday, overdue: report.overdue, dueSoon: report.dueSoon,
    stale: report.stale, tidy: report.tidy, opportunities: report.opportunities, stats: report.stats
  });
  let lastErr = 'unknown';
  // Two waves: the preferred list, then whatever OpenRouter says is free today.
  let tried = models;
  for (let wave = 0; wave < 2; wave++) {
    if (wave === 1) {
      try {
        const live = await discoverFreeModels();
        tried = [...new Set(live)].filter(m => !models.includes(m));
        if (!tried.length) break;
      } catch (err) {
        lastErr = 'no free model found (' + (err && err.message ? err.message : 'lookup failed') + ')';
        break;
      }
    }
    const hit = await tryModels(tried, key, system, user);
    if (hit.text || hit.model) return hit;
    if (hit.error) lastErr = hit.error;
  }
  return { error: lastErr };
}

async function tryModels(models, key, system, user) {
  let lastErr = 'unknown';
  for (const m of models) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key,
          'HTTP-Referer': 'https://lawrence.merqato.digital',
          'X-Title': 'MerQato workstation agent'
        },
        body: JSON.stringify({
          model: m, temperature: 0.3, max_tokens: 400,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      });
      clearTimeout(timer);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const data = await res.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text && text.trim()) return { text: text.trim(), model: m, usage: data.usage || null };
      lastErr = 'empty response';
    } catch (err) {
      lastErr = err && err.message ? err.message : String(err);
    }
  }
  return { error: lastErr };
}

module.exports = { analyse, askOpenRouter, FREE_MODELS };
