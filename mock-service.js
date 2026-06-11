const http = require('http');

const state = {
  payment: true,
  auth: true,
  db: true
};

// If a dependency is false, the service fails too!
const dependencies = {
  payment: ['auth', 'db'],
  auth: ['db'],
  db: []
};

function isActuallyHealthy(service) {
  if (!state[service]) return false;
  // Check dependencies
  for (const dep of dependencies[service]) {
    if (!isActuallyHealthy(dep)) return false;
  }
  return true;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const urlParts = req.url.split('/').filter(Boolean);
  if (urlParts.length === 2) {
    const action = urlParts[0]; // health, break, fix
    const service = urlParts[1]; // payment, auth, db

    if (['payment', 'auth', 'db'].includes(service)) {
      if (action === 'health') {
        if (isActuallyHealthy(service)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: `${service} or its dependency is broken` }));
        }
        return;
      } else if (action === 'break') {
        state[service] = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `💥 ${service} is now BROKEN.` }));
        return;
      } else if (action === 'fix') {
        state[service] = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `✅ ${service} is now FIXED.` }));
        return;
      }
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Mock Cluster running on http://localhost:${PORT}`);
  console.log(`Services: payment, auth, db`);
  console.log(`=================================================`);
  console.log(`To break a service:  curl http://localhost:${PORT}/break/db`);
  console.log(`To fix a service:    curl http://localhost:${PORT}/fix/db`);
  console.log(`=================================================`);
});
