const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const code = src.slice(src.indexOf('const P_SUPPORTED'), src.indexOf('const extMime='));
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const rejectDangerous = (s) => /<\s*(script|iframe|object|embed|base)\b/i.test(s) || /\bon\w+\s*=/i.test(s) || /javascript\s*:/i.test(s);
const M = new Function('escapeHTML', 'rejectDangerous', code + '; return {applyPagePatches,locateElement};')(escapeHTML, rejectDangerous);
const { applyPagePatches } = M;

const html = `<!doctype html><html><head></head><body>
<nav class="nav"><div class="wrap"><a class="logo">MerQato</a><div class="navlinks"><a href="#a">A</a><a href="#b">B</a></div></div></nav>
<main id="top">
<header class="hero"><h1 class="display">TITLE</h1><p class="intro">old intro</p></header>
<section class="section" id="s1"><div class="wrap"><h2 class="display h2">SECTION ONE</h2><p class="note">note text</p></div></section>
<section class="section" id="s2"><div class="wrap"><h2 class="display h2">TWO</h2></div></section>
<section class="closing"><div class="wrap"><div class="footer"><a class="mq-socials" aria-label="Social links"></a><span class="logo">MerQato Digital</span><a class="mq-footer-edit" href="/workspace">Admin</a></div></div></section>
</main></body></html>`;

let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + label); ok ? pass++ : fail++; };
const apply = (patches) => applyPagePatches(html, { patches });

// h1 is header:0 > h1:0
let out = apply([{ op: 'text', kind: 'main', path: 'header:0>h1:0', value: 'NEW TITLE' }]);
check(out.includes('NEW TITLE'), 'text: new heading written');
check(!out.includes('>TITLE<'), 'text: old heading gone');
check(out.includes('old intro'), 'text: sibling paragraph untouched');

// nested h2 inside section 1
out = apply([{ op: 'text', kind: 'main', path: 'section:1>div:0>h2:0', value: 'SECOND HEADING' }]);
check(out.includes('SECOND HEADING'), 'nested: h2 replaced');
check(out.includes('SECTION ONE'), 'nested: other section untouched');

// attribute
out = apply([{ op: 'attr', kind: 'main', path: 'header:0>p:0', name: 'class', value: 'intro lead' }]);
check(out.includes('class="intro lead"'), 'attr: class rewritten');

// nav attribute
out = apply([{ op: 'attr', kind: 'nav', path: 'div:0>div:0>a:0', name: 'href', value: 'https://example.com' }]);
check(out.includes('href="https://example.com"'), 'nav: link rewritten');
check(out.includes('href="#b"'), 'nav: sibling link intact');

// style
out = apply([{ op: 'style', kind: 'main', path: 'header:0>h1:0', value: 'color:red' }]);
check(out.includes('style="color:red"'), 'style: applied');

// remove
out = apply([{ op: 'remove', kind: 'main', path: 'header:0>p:0' }]);
check(!out.includes('old intro'), 'remove: paragraph gone');
check(out.includes('TITLE'), 'remove: h1 survived');

// add
out = apply([{ op: 'add', kind: 'main', path: '', html: '<section id="NEW">fresh</section>' }]);
check(out.includes('<section id="NEW">fresh</section>'), 'add: markup inserted');

// security
out = apply([{ op: 'text', kind: 'main', path: 'header:0>h1:0', value: '<script>alert(1)</script>' }]);
check(!out.includes('<script>'), 'security: script in text rejected');
out = apply([{ op: 'attr', kind: 'main', path: 'header:0>h1:0', name: 'href', value: 'javascript:alert(1)' }]);
check(!out.includes('javascript:alert'), 'security: javascript URL rejected');
out = apply([{ op: 'add', kind: 'main', path: '', html: '<img onerror="x()">' }]);
check(!out.includes('onerror'), 'security: event handler rejected');

// THE regression that started this: the Admin button must survive any edit
out = apply([{ op: 'text', kind: 'main', path: 'section:0>div:0>h2:0', value: 'EDITED' }]);
check(out.includes('mq-footer-edit'), 'regression: Admin link survives edits');
check(out.includes('href="/workspace"'), 'regression: Admin points at the workstation');

// multiple patches at once, applied back-to-front
out = apply([
  { op: 'text', kind: 'main', path: 'header:0>h1:0', value: 'AAA' },
  { op: 'text', kind: 'main', path: 'section:0>div:0>h2:0', value: 'BBB' },
  { op: 'remove', kind: 'main', path: 'section:1' }
]);
check(out.includes('AAA') && out.includes('BBB'), 'multi: both edits applied');
check(!out.includes('id="s2"'), 'multi: section removed');
check(out.includes('mq-footer-edit'), 'multi: footer still there');

// unknown path must not corrupt the page
out = apply([{ op: 'text', kind: 'main', path: 'nosuchtag:9>h1:0', value: 'X' }]);
check(out === html, 'safety: bad path leaves html untouched');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
