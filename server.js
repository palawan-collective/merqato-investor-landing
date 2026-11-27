'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname, PORT=Number(process.env.PORT||3000);
const BASE=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const WS=require('./workspace')(ROOT);
const DATA=path.join(ROOT,'data','site.json'),UPLOADS=path.join(ROOT,'uploads');
try{fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true})}catch(err){console.warn('No writable disk — running in read-only mode:',err.message)}
// No login. No password. The site and the workstation are open.
// Access is controlled outside the app (Cloudflare Access) if ever needed.
const LOCKED=false;
const SESSION_KEY=crypto.randomBytes(32), sessions=new Map();
const jsonHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const readState=()=>{try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{return {main:'',nav:'',css:''}}};
const send=(res,status,obj)=>{res.writeHead(status,jsonHeaders);res.end(JSON.stringify(obj))};
const readonlyNote=()=>WS.isWritable()?{}:{readonly:true,warning:'This deployment has a read-only disk, so the change was not persisted. Run on a host with a volume for permanent saves.'};
const escapeHTML=(s)=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const cookie=(req)=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>{let i=x.indexOf('=');return i<0?['','']:[x.slice(0,i).trim(),x.slice(i+1)]}));
const auth=()=>true; // no login gate
const body=(req,limit=20e6)=>new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('Too large'));req.destroy()}else chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)});
function rejectDangerous(s){return /<\s*(script|iframe|object|embed|base)\b/i.test(s)||/\bon\w+\s*=/i.test(s)||/javascript\s*:/i.test(s)}
function render(){const d=readState();let h=BASE;
  if(d.main&&!rejectDangerous(d.main))h=h.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i,d.main);
  if(d.nav&&!rejectDangerous(d.nav))h=h.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/i,d.nav);
  if(d.css)h=h.replace('</head>',`<style id="mq-admin-custom-css">${d.css.replace(/<\/?style/gi,'')}</style></head>`);
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
if(pathname==='/health'||pathname==='/api/health')return send(res,200,{ok:true,service:'merqato-investor-landing',build:'2026-11-27-no-login',node:process.version,locked:LOCKED,uptime:Math.round(process.uptime())});
if(pathname==='/api/me')return send(res,200,{authenticated:auth(req),locked:LOCKED,readonly:!WS.isWritable()});
if(pathname==='/api/site'&&req.method==='GET'){if(!auth(req))return send(res,401,{error:'Unauthorized'});return send(res,200,readState())}
if(pathname==='/api/site'&&req.method==='PUT'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const d=JSON.parse((await body(req,18e6)).toString());
 if(typeof d.main!=='string'||typeof d.nav!=='string'||typeof d.css!=='string'||d.main.length>12e6||d.nav.length>2e6||d.css.length>1e6||rejectDangerous(d.main)||rejectDangerous(d.nav))return send(res,400,{error:'Invalid or unsafe content'});
 const current=readState();if(fs.existsSync(DATA))fs.copyFileSync(DATA,path.join(ROOT,'data','site.backup.json'));
 fs.writeFileSync(DATA+'.tmp',JSON.stringify({main:d.main,nav:d.nav,css:d.css,updated:new Date().toISOString()}));fs.renameSync(DATA+'.tmp',DATA);return send(res,200,{ok:true});
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
if(pathname==='/api/workspace/link/reveal'&&req.method==='POST'){
 if(!auth(req))return send(res,401,{error:'Unauthorized'});
 const v=JSON.parse((await body(req,5000)).toString());const l=(WS.load().links||[]).find(x=>x.id===v.id);
 if(!l)return send(res,404,{error:'Link not found'});
 return send(res,200,{password:WS.decrypt(l.secret)});
}
if(pathname==='/workspace'||pathname==='/workspace/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN'});return res.end(fs.readFileSync(path.join(ROOT,'public','workstation.html')))}
if(pathname.startsWith('/p/')){const slug=pathname.slice(3).replace(/[^a-z0-9-]/gi,'').toLowerCase();const html=WS.renderProject(slug);if(!html)return send(res,404,{error:'Project not found'});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(html)}
if(pathname==='/admin'||pathname==='/admin/'){res.writeHead(302,{location:'/workspace','cache-control':'no-store'});return res.end()}
if(pathname==='/admin/edit'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN'});return res.end(fs.readFileSync(path.join(ROOT,'public','admin.html')))}
if(pathname==='/'||pathname==='/index.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN'});return res.end(render())}
return send(res,404,{error:'Not found'});
}catch(err){console.error(err);if(!res.headersSent)send(res,500,{error:'Request failed'})}
}).listen(PORT,'0.0.0.0',()=>console.log(`MerQato site + admin at http://localhost:${PORT} — admin /admin`));
