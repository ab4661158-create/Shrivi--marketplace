const http=require('http');
const{spawn}=require('child_process');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT)||10000;
const INTERNAL_PORT=PUBLIC_PORT===10001?10002:10001;

const scripts=[
  ['shrivi-features.js','shrivi-features.js'],['shrivi-upgrade-suite.js','shrivi-upgrade-suite.js'],['amazon-style-upgrade.js','amazon-style-upgrade.js'],['shrivi-production-upgrade.js','shrivi-production-upgrade.js'],['shrivi-customer-backend.js','shrivi-customer-backend.js'],['shrivi-app-init.js','shrivi-app-init.js'],['seller-pro-listing-ui.js','seller-pro-listing-ui.js'],['seller-8-slots.js','seller-8-slots.js'],['customer-gallery-v2.js','customer-gallery-v2.js']
];
const assets=Object.fromEntries(scripts.map(([url,file])=>['/'+url,fs.readFileSync(path.join(__dirname,file),'utf8')]));
const tags=scripts.map(([url])=>`<script src="/${url}?v=31"></script>`).join('\n');

const child=spawn(process.execPath,[path.join(__dirname,'shrivi-production-start.js')],{env:{...process.env,PORT:String(INTERNAL_PORT)},stdio:'inherit'});
child.on('exit',c=>{console.error(`[Shrivi] backend exited with code ${c}`);process.exit(c??1)});

const server=http.createServer((req,res)=>{
  const pathname=(req.url||'/').split('?')[0];
  if(assets[pathname]){res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'});return res.end(assets[pathname]);}
  const proxyReq=http.request({hostname:'127.0.0.1',port:INTERNAL_PORT,method:req.method,path:req.url,headers:{...req.headers,host:`127.0.0.1:${INTERNAL_PORT}`,'accept-encoding':'identity'}},proxyRes=>{
    const type=String(proxyRes.headers['content-type']||'').toLowerCase();
    const inject=req.method==='GET'&&/text\/html/.test(type)&&['/shop','/shop/','/seller','/seller/','/','/admin','/admin/'].includes(pathname);
    if(!inject){res.writeHead(proxyRes.statusCode||200,proxyRes.headers);return proxyRes.pipe(res)}
    const chunks=[];proxyRes.on('data',c=>chunks.push(c));proxyRes.on('end',()=>{let html=Buffer.concat(chunks).toString('utf8');html=html.replace(/<script[^>]+(?:shrivi-features|shrivi-upgrade-suite|amazon-style-upgrade|shrivi-production-upgrade|shrivi-customer-backend|shrivi-app-init|seller-pro-listing-ui|seller-gallery-v2|seller-multi-images|seller-multi-select-fix|seller-8-slots|customer-gallery-v2|seller-final-fix|seller-images-router-fix)[^>]*><\/script>/gi,'');html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,`${tags}\n</body>`):`${html}\n${tags}`;const headers={...proxyRes.headers};delete headers['content-length'];delete headers.etag;delete headers['content-encoding'];headers['content-type']='text/html; charset=utf-8';headers['cache-control']='no-store';res.writeHead(proxyRes.statusCode||200,headers);res.end(html)});
  });
  proxyReq.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'text/plain; charset=utf-8'});if(!res.writableEnded)res.end('Shrivi service temporarily unavailable.')});req.pipe(proxyReq);
});
server.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`Shrivi feature proxy listening on ${PUBLIC_PORT}`));
function shutdown(){server.close(()=>child.kill('SIGTERM'));setTimeout(()=>child.kill('SIGKILL'),5000).unref()}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
