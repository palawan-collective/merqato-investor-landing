'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname, PORT=Number(process.env.PORT||3000);
const BASE=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const DATA=path.join(ROOT,'data','site.json'),UPLOADS=path.join(ROOT,'uploads');
fs.mkdirSync(path.dirname(DATA),{recursive:true});
fs.mkdirSync(UPLOADS,{recursive:true});
const PREVIEW_MODE=process.env.MQ_LOCAL_PREVIEW==='1'&&process.env.NODE_ENV!=='production';
const PASSWORD=process.env.ADMIN_PASSWORD;
if(!PREVIEW_MODE&&(!PASSWORD||PASSWORD.length<12)){console.error('Set ADMIN_PASSWORD (12+ characters) before starting.');process.exit(1)}
const SESSION_KEY=crypto.randomBytes(32), sessions=new Map();
const jsonHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const readState=()=>{try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{return {main:'',nav:'',css:''}}};
const send=(res,status,obj)=>{res.writeHead(status,jsonHeaders);res.end(JSON.stringify(obj))};
const escapeHTML=(s)=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const cookie=(req)=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>{let i=x.indexOf('=');return i<0?['','']:[x.slice(0,i).trim(),x.slice(i+1)]}));
const auth=(req)=>{if(PREVIEW_MODE)return true;const token=cookie(req).mq_session;return !!(token&&sessions.get(token)>Date.now())};
const body=(req,limit=20e6)=>new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('Too large'));req.destroy()}else chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)});
function rejectDangerous(s){return /<\s*(script|iframe|object|embed|base)\b/i.test(s)||/\bon\w+\s*=/i.test(s)||/javascript\s*:/i.test(s)}
function render(){const d=readState();let h=BASE;
  if(d.main&&!rejectDangerous(d.main))h=h.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i,d.main);
  if(d.nav&&!rejectDangerous(d.nav))h=h.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/i,d.nav);
  if(d.css)h=h.replace('</head>',`<style id="mq-admin-custom-css">${d.css.replace(/<\/?style/gi,'')}</style></head>`);
  return h;
}
const extMime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
http.createServer(async(req,res)=>{
try{
const u=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(u.pathname);
if(pathname==='/api/login'&&req.method==='POST'){
 let val=JSON.parse((await body(req,10000)).toString());const a=crypto.createHash('sha256').update(String(val.password||'')).digest(),b=crypto.createHash('sha256').update(PASSWORD).digest();
 if(!crypto.timingSafeEqual(a,b))return send(res,401,{error:'Wrong password'});
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+86400000);
 res.setHeader('Set-Cookie',`mq_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`);
 return send(res,200,{ok:true});
}
if(pathname==='/api/logout'&&req.method==='POST'){const t=cookie(req).mq_session;sessions.delete(t);res.setHeader('Set-Cookie','mq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true})}
if(pathname==='/api/me')return send(res,200,{authenticated:auth(req)});
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
   'video/mp4':['mp4',100e6],'video/webm':['webm',100e6],'video/quicktime':['mov',100e6]};
 const contentType=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 let mime=contentType,buffer;
 if(contentType==='application/json'){
  const d=JSON.parse((await body(req,15e6)).toString());const m=String(d.data||'').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s);
  if(!m)return send(res,400,{error:'Unsupported media'});
  mime=m[1];buffer=Buffer.from(m[2],'base64');
 }else{
  if(!types[mime])return send(res,415,{error:'Use PNG, JPEG, WebP, GIF, MP4, WebM or MOV'});
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
  'video/webm':x=>x.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))
 };
 if(!signatures[mime](buffer))return send(res,415,{error:'File contents do not match media type'});
 const name=crypto.randomBytes(12).toString('hex')+'.'+types[mime][0];
 fs.mkdirSync(UPLOADS,{recursive:true});fs.writeFileSync(path.join(UPLOADS,name),buffer,{flag:'wx'});
 return send(res,201,{url:'/uploads/'+name,type:mime,bytes:buffer.length});
}
if(pathname.startsWith('/uploads/')){const f=path.basename(pathname),e=path.extname(f).toLowerCase();if(!extMime[e]||f!==pathname.slice(9))return send(res,404,{error:'Not found'});const fp=path.join(UPLOADS,f);if(!fs.existsSync(fp))return send(res,404,{error:'Not found'});res.writeHead(200,{'content-type':extMime[e],'cache-control':'public, max-age=3600','x-content-type-options':'nosniff'});return fs.createReadStream(fp).pipe(res)}
if(pathname==='/admin'||pathname==='/admin/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN'});return res.end(fs.readFileSync(path.join(ROOT,'public','admin.html')))}
if(pathname==='/'||pathname==='/index.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN'});return res.end(render())}
return send(res,404,{error:'Not found'});
}catch(err){console.error(err);if(!res.headersSent)send(res,500,{error:'Request failed'})}
}).listen(PORT,'0.0.0.0',()=>console.log(`MerQato site + admin at http://localhost:${PORT} — admin /admin`));
