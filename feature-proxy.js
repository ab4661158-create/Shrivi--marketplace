const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUBLIC_PORT = Number(process.env.PORT) || 10000;
const INTERNAL_PORT = PUBLIC_PORT === 10001 ? 10002 : 10001;
const featureScript = fs.readFileSync(path.join(__dirname, 'shrivi-features.js'), 'utf8');

const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, PORT: String(INTERNAL_PORT) },
  stdio: 'inherit'
});

child.on('exit', code => process.exit(code ?? 1));

const server = http.createServer((req, res) => {
  if (req.url === '/shrivi-features.js') {
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store'
    });
    return res.end(featureScript);
  }

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${INTERNAL_PORT}`, 'accept-encoding': 'identity' }
  }, proxyRes => {
    const type = String(proxyRes.headers['content-type'] || '').toLowerCase();
    const inject = req.method === 'GET' && /text\/html/.test(type) && (req.url === '/shop' || req.url === '/shop/');

    if (!inject) {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      return proxyRes.pipe(res);
    }

    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf8');
      if (!html.includes('/shrivi-features.js')) {
        html = html.replace(/<\/body>/i, '<script src="/shrivi-features.js"></script>\n</body>');
      }
      const headers = { ...proxyRes.headers };
      delete headers['content-length'];
      delete headers.etag;
      delete headers['content-encoding'];
      headers['content-type'] = 'text/html; charset=utf-8';
      headers['cache-control'] = 'no-store';
      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(html);
    });
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Shrivi service temporarily unavailable.');
  });

  req.pipe(proxyReq);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`Shrivi feature proxy listening on ${PUBLIC_PORT}`);
});

function shutdown() {
  server.close(() => child.kill('SIGTERM'));
  setTimeout(() => child.kill('SIGKILL'), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);