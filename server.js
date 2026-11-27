'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname, PORT=Number(process.env.PORT||3000);
const VERSION='2026-11-27-v9';
const STARTED=new Date().toISOString();
const BASE=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const WS=require('./workspace')(ROOT);
const AGENT=require('./agent.js');
const DATA=path.join(ROOT,'data','site.json'),UPLOADS=path.join(ROOT,'uploads');
try{fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true})}catch(err){console.warn('No writable disk — running in read-only mode:',err.message)}
// No login. No password. The site and the workstation are open.
// Access is controlled outside the app (Cloudflare Access) if ever needed.
const LOCKED=false;
const SESSION_KEY=crypto.randomBytes(32), sessions=new Map();
const jsonHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const readState=()=>{try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{return {main:'',nav:'',css:''}}};
const send=(res,status,obj)=>{res.writeHead(status,jsonHeaders);res.end(JSON.stringify(obj))};
// Every page is generated fresh on each request, so nothing may be stored by the
// browser, Cloudflare, or any proxy. Without this, a deploy ships but visitors keep
// seeing yesterday's copy and blame the deploy. HTML is always no-store; uploads are
// content-addressed filenames that never change, so they stay cacheable.
const HTML_HEAD={'content-type':'text/html; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate, max-age=0','pragma':'no-cache','expires':'0','x-frame-options':'SAMEORIGIN'};
const page=(res,html,extra={})=>{res.writeHead(200,{...HTML_HEAD,...extra});res.end(html)};
const agentCache=new Map();
const readonlyNote=()=>WS.isWritable()?{}:{readonly:true,warning:'This deployment has a read-only disk, so the change was not persisted. Run on a host with a volume for permanent saves.'};
const escapeHTML=(s)=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const cookie=(req)=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>{let i=x.indexOf('=');return i<0?['','']:[x.slice(0,i).trim(),x.slice(i+1)]}));
const auth=()=>true; // no login gate
const body=(req,limit=20e6)=>new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('Too large'));req.destroy()}else chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)});
function rejectDangerous(s){return /<\s*(script|iframe|object|embed|base)\b/i.test(s)||/\bon\w+\s*=/i.test(s)||/javascript\s*:/i.test(s)}
// ---------------------------------------------------------------------------
// Patch-based page editing.
//
// The page editor used to save a complete clone of <main> and <nav>. That clone
// was frozen in data/site.json and pasted over the live HTML on every request,
// so any later change to index.html — a footer button, a mobile fix — was
// silently thrown away. The server was serving new code and old markup, which is
// exactly what "I deployed and nothing changed" looks like from a browser.
//
// Now the editor saves only a list of patches: text, attributes, style, removal
// and addition, addressed by a stable path (tag + index chain) from <main> or
// <nav>. Building the page always starts from the current index.html and applies
// those patches, so new markup survives.
//
// Saves written by the old editor are recognised automatically (no `patches`
// field, a <main> string present) and applied as a one-time overlay so nothing
// is lost — but they display a warning telling you to re-save.
// ---------------------------------------------------------------------------
const P_SUPPORTED = new Set(['text', 'attr', 'style', 'remove', 'add']);
const patchSafe = (s) => !rejectDangerous(s) && !/<script\b/i.test(s);
// Attribute values are inlined into HTML, so reject script-ish URLs outright.
const attrSafe = (v) => !/^\s*javascript:/i.test(v) && String(v).length <= 20000;


// Generic single-element lookup: path "section2>div0>p3".
// --- locating an element by path -------------------------------------------
// A path is "tagIndex>tagIndex>..." where the index counts same-tag children
// (0-based), e.g. "section1>div0>h2". Walking it from <main> or <nav> finds one
// element exactly, and it keeps pointing at that element when unrelated parts of
// the page change — which is why the editor no longer needs to store markup.
const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

// Index the HTML into a small tree of {tag, start, openLen, end, children}.
function buildTree(html, from, to){
  const root={tag:'#root', start:from, openLen:0, end:to, children:[]};
  const stack=[root];
  const re=/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  re.lastIndex=from;
  let m;
  while((m=re.exec(html)) && m.index<to){
    const closing=m[1]==='/', tag=m[2].toLowerCase(), whole=m[0];
    if(closing){
      for(let i=stack.length-1;i>0;i--){
        if(stack[i].tag===tag){
          stack[i].end=m.index+whole.length;
          stack.length=i;
          break;
        }
      }
      continue;
    }
    const node={tag, start:m.index, openLen:whole.length, end:null, children:[]};
    if(/\/>$/.test(whole)||VOID_TAGS.has(tag))node.end=m.index+whole.length;
    stack[stack.length-1].children.push(node);
    if(node.end===null)stack.push(node);
  }
  for(const n of stack)if(n.end===null)n.end=to;
  return root;
}

// Find the element a path points at, inside the container element's tree.
// Find the first opening tag of `tag`, matching whole tag names only so <main>
// never matches <mainfoo>. Plain string work — no regex, no escaping surprises.
function findOpenTag(html, tag){
  const needle='<'+tag;
  let at=html.indexOf(needle);
  while(at!==-1){
    const next=html.charAt(at+needle.length);
    if(next==='>'||next===' '||next==='\n'||next==='\t'||next==='\r'||next==='/')return at;
    at=html.indexOf(needle, at+1);
  }
  return -1;
}
function locateElement(html, containerTag, path){
  const at=findOpenTag(html, containerTag);
  if(at<0)return null;
  const root=buildTree(html, at, html.length);
  const container=root.children.find(c=>c.tag===containerTag);
  if(!container)return null;
  let node=container;
  const steps=String(path||'').split('>').filter(Boolean);
  if(!steps.length)return container; // empty path means the container itself
  for(const part of steps){
    // Tag and index are separated by a colon because tag names contain digits
    // (h1, h2, h3) and "h1" would otherwise parse as tag "h", index 1.
    const mt=/^([a-z][a-z0-9]*):(\d+)$/.exec(part);
    if(!mt)return null;
    const tag=mt[1], idx=Number(mt[2]);
    const kids=node.children.filter(c=>c.tag===tag);
    node=kids[idx];
    if(!node)return null;
  }
  return node;
}

function applyPagePatches(h, state){
  const patches=Array.isArray(state.patches)?state.patches.filter(p=>p&&P_SUPPORTED.has(p.op)):[];
  if(!patches.length)return h;
  let out=h;
  for(const p of patches){
    const kind=p.kind==='nav'?'nav':'main';
    let node;
    try{ node=locateElement(out,kind,p.path); }catch{ node=null; }
    if(!node)continue;
    const head=out.slice(node.start,node.start+node.openLen);
    if(p.op==='text'){
      const v=String(p.value??'');
      if(!patchSafe(v))continue;
      // node.end is *after* the closing tag, so the close tag sits just before it.
      const closeTag=out.slice(node.start,node.end).match(/<\/[a-zA-Z0-9]+>$/)?.[0]||'';
      out=out.slice(0,node.start+node.openLen)+v+out.slice(node.end-closeTag.length);
    }else if(p.op==='remove'){
      out=out.slice(0,node.start)+out.slice(node.end);
    }else if(p.op==='add'){
      const v=String(p.html??'');
      if(!v||!patchSafe(v))continue;
      out=out.slice(0,node.start+node.openLen)+v+out.slice(node.start+node.openLen);
    }else if(p.op==='attr'){
      const name=String(p.name||'').toLowerCase(), v=String(p.value??'');
      if(!/^[a-z][a-z0-9-]*$/.test(name)||!attrSafe(v))continue;
      let next=head.replace(new RegExp('\\s'+name+'="[^"]*"','i'),'');
      if(v!=='')next=next.replace(/^<([a-zA-Z0-9]+)/,(all,t)=>'<'+t+' '+name+'="'+escapeHTML(v)+'"');
      out=out.slice(0,node.start)+next+out.slice(node.start+node.openLen);
    }else if(p.op==='style'){
      const v=String(p.value??'');
      if(!patchSafe(v)||/expression\s*\(/i.test(v))continue;
      const next=head.replace(/\sstyle="[^"]*"/i,'').replace(/^<([a-zA-Z0-9]+)/,(all,t)=>'<'+t+' style="'+escapeHTML(v)+'"');
      out=out.slice(0,node.start)+next+out.slice(node.start+node.openLen);
    }
  }
  return out;
}


function render(){
  const d=readState();
  let h=BASE;
  // New editor: patches only, applied to the current index.html.
  if(Array.isArray(d.patches)&&d.patches.length){
    h=applyPagePatches(h,d);
  }else if(typeof d.main==='string'&&d.main&&!rejectDangerous(d.main)){
    // Legacy save from the old editor: a frozen full clone. Applied so nothing
    // the user wrote is lost, but it is the reason new markup never appeared.
    h=h.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i,d.main);
    if(typeof d.nav==='string'&&d.nav&&!rejectDangerous(d.nav))h=h.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/i,d.nav);
    h=h.replace(/<\/body>/i,'<div style="position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 16px;background:#111;color:#fff;font:600 13px/1.4 Arial,sans-serif">This page is showing a snapshot saved by the old page editor on '
      +escapeHTML(d.updated||'an earlier date')+' — new changes are being hidden by it. Open the workstation, then Edit site design, and press Save once to convert it to the new format.</div></body>');
  }
  if(d.css)h=h.replace('</head>',`<style id="mq-admin-custom-css">${String(d.css).replace(/<\/?style/gi,'')}</style></head>`);
  return h;
}
const extMime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv','.zip':'application/zip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
http.createServer(async(req,res)=>{
try{
const u=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(u.pathname);
if(pathname==='/api/login'&&req.method==='POST'){

 if(!LOCKED)return send(res,200,{ok:true});
 let val=JSON.parse((await body(req,10000)).toString());const a=crypto.createHash('sha256').update(String(val.password||'')).digest(),b=crypto.createHash('sha256').update(PASSWORD).digest();
 if(!crypto.timingSafeEqual(a,b))return send(res,401,{error:'Wrong password'});
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+86400000);
 res.setHeader('Set-Cookie',`mq_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`);
 return send(res,200,{ok:true});
}
if(pathname==='/api/logout'&&req.method==='POST'){const t=cookie(req).mq_session;sessions.delete(t);res.setHeader('Set-Cookie','mq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true})}
if(pathname==='/health'||pathname==='/api/health')return send(res,200,{ok:true,service:'merqato-investor-landing',build:VERSION,started:STARTED,cwd:ROOT,node:process.version,locked:LOCKED,uptime:Math.round(process.uptime())});
if(pathname==='/api/me')return send(res,200,{authenticated:auth(req),locked:LOCKED,readonly:!WS.isWritable()});
if(pathname==='/api/site'&&req.method==='GET'){if(!auth(req))return send(res,401,{error:'Unauthorized'});return send(res,200,readState())}
if(pathname==='/api/site'&&req.method==='PUT'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const d=JSON.parse((await body(req,18e6)).toString());
 const css=typeof d.css==='string'?d.css:'';
 if(css.length>1e6)return send(res,400,{error:'Custom CSS is too large'});
 // New format: a list of patches. Nothing here may contain script or handlers.
 if(Array.isArray(d.patches)){
   if(d.patches.length>4000)return send(res,400,{error:'Too many edits in one save'});
   const clean=[];
   for(const p of d.patches){
     if(!p||!P_SUPPORTED.has(p.op)||(p.kind!=='main'&&p.kind!=='nav'))continue;
     const path=typeof p.path==='string'?p.path:'';
     if(p.op!=='add'&&!/^([a-z][a-z0-9]*:\d+)(>[a-z][a-z0-9]*:\d+)*$/.test(path))continue;
     const item={op:p.op,kind:p.kind,path};
     if(p.op==='text'){const v=String(p.value??'');if(v.length>200000||!patchSafe(v))continue;item.value=v}
     else if(p.op==='attr'){const name=String(p.name||'').toLowerCase(),v=String(p.value??'');if(!/^[a-z][a-z0-9-]*$/.test(name)||!attrSafe(v))continue;item.name=name;item.value=v}
     else if(p.op==='style'){const v=String(p.value??'');if(v.length>20000||!patchSafe(v))continue;item.value=v}
     else if(p.op==='add'){const v=String(p.html??'');if(!v||v.length>200000||!patchSafe(v))continue;item.html=v}
     else if(p.op==='remove'){ /* path is enough */ }
     clean.push(item);
   }
   const current=readState();
   if(fs.existsSync(DATA))fs.copyFileSync(DATA,path.join(ROOT,'data','site.backup.json'));
   // Legacy main/nav are dropped on purpose: that snapshot is what hid every new
   // change to index.html. The backup file above still holds it.
   fs.writeFileSync(DATA+'.tmp',JSON.stringify({patches:clean,css,updated:new Date().toISOString(),format:'patches'}));
   fs.renameSync(DATA+'.tmp',DATA);
   return send(res,200,{ok:true,patches:clean.length,...readonlyNote()});
 }
 // Legacy body: accept it so the editor cannot fail mid-upgrade, and store it as
 // before. It keeps working but keeps hiding new markup until it is re-saved.
 if(typeof d.main!=='string'||typeof d.nav!=='string'||d.main.length>12e6||d.nav.length>2e6||rejectDangerous(d.main)||rejectDangerous(d.nav))return send(res,400,{error:'Invalid or unsafe content'});
 if(fs.existsSync(DATA))fs.copyFileSync(DATA,path.join(ROOT,'data','site.backup.json'));
 fs.writeFileSync(DATA+'.tmp',JSON.stringify({main:d.main,nav:d.nav,css,updated:new Date().toISOString(),format:'legacy'}));fs.renameSync(DATA+'.tmp',DATA);
 return send(res,200,{ok:true,warning:'Saved in the old full-page format. Re-save from the editor to convert it to patches.'});
}
if(pathname==='/api/upload'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const types={'image/png':['png',10e6],'image/jpeg':['jpg',10e6],'image/webp':['webp',10e6],'image/gif':['gif',10e6],
   'video/mp4':['mp4',100e6],'video/webm':['webm',100e6],'video/quicktime':['mov',100e6],
   'application/pdf':['pdf',25e6],'text/plain':['txt',5e6],'text/csv':['csv',5e6],'application/zip':['zip',25e6],
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx',25e6]};
 const contentType=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 let mime=contentType,buffer;
 if(contentType==='application/json'){
  const d=JSON.parse((await body(req,15e6)).toString());const m=String(d.data||'').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s);
  if(!m)return send(res,400,{error:'Unsupported media'});
  mime=m[1];buffer=Buffer.from(m[2],'base64');
 }else{
  if(!types[mime])return send(res,415,{error:'Use PNG, JPEG, WebP, GIF, MP4, WebM, MOV, PDF, TXT, CSV, ZIP or DOCX'});
  buffer=await body(req,types[mime][1]+1);
 }
 if(!types[mime]||buffer.length>types[mime][1])return send(res,413,{error:'File exceeds media size limit'});
 const signatures={
  'image/png':x=>x.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),
  'image/jpeg':x=>x[0]===0xff&&x[1]===0xd8&&x[2]===0xff,
  'image/webp':x=>x.toString('ascii',0,4)==='RIFF'&&x.toString('ascii',8,12)==='WEBP',
  'image/gif':x=>x.toString('ascii',0,3)==='GIF',
  'video/mp4':x=>x.toString('ascii',4,8)==='ftyp',
  'video/quicktime':x=>x.toString('ascii',4,8)==='ftyp',
  'video/webm':x=>x.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')),
  'application/pdf':x=>x.toString('ascii',0,4)==='%PDF',
  'text/plain':x=>x.length<=5e6,
  'text/csv':x=>x.length<=5e6,
  'application/zip':x=>x.subarray(0,2).toString('ascii')==='PK',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':x=>x.subarray(0,2).toString('ascii')==='PK'
 };
 if(!signatures[mime](buffer))return send(res,415,{error:'File contents do not match media type'});
 const name=crypto.randomBytes(12).toString('hex')+'.'+types[mime][0];
 fs.mkdirSync(UPLOADS,{recursive:true});fs.writeFileSync(path.join(UPLOADS,name),buffer,{flag:'wx'});
 return send(res,201,{url:'/uploads/'+name,type:mime,bytes:buffer.length});
}
if(pathname.startsWith('/uploads/')){const f=path.basename(pathname),e=path.extname(f).toLowerCase();if(!extMime[e]||f!==pathname.slice(9))return send(res,404,{error:'Not found'});const fp=path.join(UPLOADS,f);if(!fs.existsSync(fp))return send(res,404,{error:'Not found'});res.writeHead(200,{'content-type':extMime[e],'cache-control':'public, max-age=3600','x-content-type-options':'nosniff'});return fs.createReadStream(fp).pipe(res)}
if(pathname==='/api/workspace'&&req.method==='GET'){if(!auth(req))return send(res,401,{error:'Unauthorized'});return send(res,200,WS.publicState(WS.load()))}
if(pathname==='/api/workspace'&&req.method==='PUT'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const d=JSON.parse((await body(req,10e6)).toString());
 const ok=d&&typeof d==='object'&&Array.isArray(d.projects)&&Array.isArray(d.ideas)&&Array.isArray(d.files)&&Array.isArray(d.links)&&Array.isArray(d.comments)&&d.brand&&typeof d.brand==='object';
 if(!ok)return send(res,400,{error:'Invalid workspace data'});
 const cur=WS.load();
 d.links=d.links.map(l=>{const out={...l};const old=(cur.links||[]).find(x=>x.id===out.id);delete out.password;delete out.keepSecret;out.secret=typeof l.password==='string'&&l.password.length?WS.encrypt(l.password):(l.keepSecret&&old?old.secret:null);return out});
 WS.save(d);return send(res,200,{ok:true,...readonlyNote()});
}
if(pathname==='/api/workspace/comment'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const v=JSON.parse((await body(req,30000)).toString());
 if(!v||typeof v.text!=='string'||!v.text.trim()||v.text.length>4000)return send(res,400,{error:'Comment must be 1-4000 characters'});
 const prios=['Low','Medium','High','Urgent'];
 const attachments=Array.isArray(v.attachments)?v.attachments.slice(0,10).map(a=>({id:crypto.randomBytes(5).toString('hex'),url:/^\/uploads\/[A-Za-z0-9._-]+$/.test(a&&a.url)||/^https?:\/\/[^\s"'<>]+$/.test(a&&a.url)?a.url:'',type:/^video\//i.test(a&&a.type)?'video':'image',name:String(a&&a.name||'').slice(0,140)})).filter(a=>a.url):[];
 const d=WS.load();
 d.comments.unshift({id:crypto.randomBytes(6).toString('hex'),
   scope:v.scope&&typeof v.scope==='object'?{type:String(v.scope.type||'general').slice(0,20),id:String(v.scope.id||'').slice(0,60)}:{type:'general',id:''},
   author:String(v.author||'Partner').slice(0,60),text:v.text.trim(),
   url:/^https?:\/\/[^\s"'<>]+$/.test(v.url||'')?v.url:'',
   image:/^\/uploads\/[A-Za-z0-9._-]+$/.test(v.image||'')?v.image:'',
   attachments,
   priority:prios.includes(v.priority)?v.priority:'Medium',
   done:false,created:new Date().toISOString(),completedAt:'',completedBy:''});
 d.comments=d.comments.slice(0,400);WS.save(d);return send(res,200,{ok:true,...readonlyNote()});
}
if(pathname==='/api/workspace/comment/status'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const v=JSON.parse((await body(req,10000)).toString());
 const d=WS.load(),c=(d.comments||[]).find(x=>x.id===v.id);
 if(!c)return send(res,404,{error:'Comment not found'});
 if('priority' in v&&['Low','Medium','High','Urgent'].includes(v.priority))c.priority=v.priority;
 if('done' in v){c.done=!!v.done;c.completedAt=c.done?new Date().toISOString():'';c.completedBy=c.done?String(v.author||c.author||'Partner').slice(0,60):''}
 WS.save(d);return send(res,200,{ok:true,comment:c,...readonlyNote()});
}
if(pathname==='/api/workspace/idea'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const v=JSON.parse((await body(req,20000)).toString());
 if(!v||typeof v.title!=='string'||!v.title.trim()||v.title.length>200)return send(res,400,{error:'Give the idea a short title'});
 const d=WS.load();d.ideas.unshift({id:crypto.randomBytes(6).toString('hex'),title:v.title.trim().slice(0,200),description:String(v.description||'').slice(0,3000),status:'New',created:new Date().toISOString()});
 WS.save(d);return send(res,200,{ok:true,...readonlyNote()});
}
if(pathname==='/api/agent'&&req.method==='GET'){
 // Office agent: local analysis always; optional OpenRouter rewrite of the summary.
 const d=WS.load();
 const report=AGENT.analyse(d);
 const key=process.env.OPENROUTER_API_KEY;
 report.ai=(key?'configured':'off');
 const wantModel=u.searchParams.get('ai')!=='0';
 if(key&&wantModel){
   const cacheKey='agent:'+d.updated+':'+(process.env.OPENROUTER_MODEL||'auto');
   const cached=agentCache.get(cacheKey);
   if(cached&&cached.expires>Date.now()){Object.assign(report,{mode:'ai',model:cached.model,summary:cached.text});}
   else{
     const ai=await AGENT.askOpenRouter(report,process.env.OPENROUTER_MODEL);
     if(ai&&ai.text){
       agentCache.set(cacheKey,{text:ai.text,model:ai.model,expires:Date.now()+15*60000});
       Object.assign(report,{mode:'ai',model:ai.model,summary:ai.text});
     }else{
       Object.assign(report,{mode:'local',aiError:ai&&ai.error?ai.error:'unavailable'});
     }
   }
 }
 return send(res,200,report);
}
if(pathname==='/api/workspace/link/reveal'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const v=JSON.parse((await body(req,5000)).toString());const l=(WS.load().links||[]).find(x=>x.id===v.id);
 if(!l)return send(res,404,{error:'Link not found'});
 return send(res,200,{password:WS.decrypt(l.secret)});
}
if(pathname==='/workspace'||pathname==='/workspace/'){
 const html=fs.readFileSync(path.join(ROOT,'public','workstation.html'),'utf8').replace('</head>','<meta name="mq-build" content="'+VERSION+'"></head>');
 return page(res,html)}
if(pathname.startsWith('/p/')){const slug=pathname.slice(3).replace(/[^a-z0-9-]/gi,'').toLowerCase();const html=WS.renderProject(slug);if(!html)return send(res,404,{error:'Project not found'});return page(res,html)}
if(pathname==='/admin'||pathname==='/admin/'){res.writeHead(302,{location:'/workspace','cache-control':'no-store'});return res.end()}
if(pathname==='/admin/edit'){return page(res,fs.readFileSync(path.join(ROOT,'public','admin.html')))}
if(pathname==='/'||pathname==='/index.html'){return page(res,render())}
return send(res,404,{error:'Not found'});
}catch(err){console.error(err);if(!res.headersSent)send(res,500,{error:'Request failed'})}
}).listen(PORT,'0.0.0.0',()=>console.log(`MerQato site + admin at http://localhost:${PORT} — admin /admin`));
