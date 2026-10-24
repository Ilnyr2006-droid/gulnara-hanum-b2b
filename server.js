'use strict';
// Optional local and self-hosted HTTP server; Vercel uses api/lead.js directly.
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const handler=require('./api/lead');
const root=__dirname;
const allow=new Set(['/','/index.html','/app.js','/enhancements.css','/privacy.html','/robots.txt','/llms.txt']);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};
function createServer(){
  return http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/lead')return handler(req,res);
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  let pathname;
  try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400);return res.end();}
  if(!allow.has(pathname)&&!/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)){
    res.writeHead(404);return res.end('Not found');
  }
  const file=path.join(root,pathname==='/'?'index.html':pathname.slice(1));
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(file).pipe(res);
  });
  });
}

if(require.main===module){
  const host=process.env.HOST||'127.0.0.1';
  const port=Number(process.env.PORT||3000);
  createServer().listen(port,host,()=>console.log('Server listening on '+host+':'+port));
}

module.exports={createServer};
