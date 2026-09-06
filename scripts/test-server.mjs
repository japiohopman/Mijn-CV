import { spawn } from 'node:child_process';
import http from 'node:http';

console.log('Testing Express server routes...');

const PORT = 3099;

const serverProc = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});

function fetchRoute(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      resolve(res.statusCode);
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function runTests() {
  await new Promise(r => setTimeout(r, 1000));

  const routes = ['/', '/share', '/keuken-cv', '/github_action.png'];
  let success = true;

  for (const route of routes) {
    try {
      const status = await fetchRoute(route);
      if (status === 200) {
        console.log(`✓ GET ${route} -> Status 200`);
      } else {
        console.error(`✗ GET ${route} -> Status ${status}`);
        success = false;
      }
    } catch (err) {
      console.error(`✗ GET ${route} -> Error: ${err.message}`);
      success = false;
    }
  }

  serverProc.kill();

  if (!success) {
    process.exit(1);
  } else {
    console.log('All route tests passed!');
  }
}

runTests().catch(err => {
  serverProc.kill();
  console.error(err);
  process.exit(1);
});
