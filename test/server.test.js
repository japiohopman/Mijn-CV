const { spawn } = require('child_process');
const http = require('http');

console.log('Testing Express server routes & static assets...');

const PORT = process.env.TEST_PORT || 3099;

const serverProc = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function fetchRoute(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function waitForServer(maxAttempts = 20, intervalMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetchRoute('/');
      return true;
    } catch (err) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Server failed to start on port ${PORT} after ${maxAttempts * intervalMs}ms`);
}

async function runTests() {
  let exitCode = 0;

  try {
    await waitForServer();

    const testCases = [
      { path: '/', expectedStatus: 200 },
      { path: '/share', expectedStatus: 200 },
      { path: '/keuken-cv', expectedStatus: 200 },
      { path: '/github_action.png', expectedStatus: 200 },
      { path: '/styles.css', expectedStatus: 200 },
      { path: '/app.js', expectedStatus: 200 },
      { path: '/keuken_cv', expectedStatus: 301 },
    ];

    let success = true;

    for (const { path, expectedStatus } of testCases) {
      try {
        const status = await fetchRoute(path);
        if (status === expectedStatus) {
          console.log(`✓ GET ${path} -> Status ${status} (expected ${expectedStatus})`);
        } else {
          console.error(`✗ GET ${path} -> Status ${status} (expected ${expectedStatus})`);
          success = false;
        }
      } catch (err) {
        console.error(`✗ GET ${path} -> Error: ${err.message}`);
        success = false;
      }
    }

    if (!success) {
      exitCode = 1;
    } else {
      console.log('All Express route and asset tests passed successfully!');
    }
  } catch (err) {
    console.error(`✗ Server health check failed: ${err.message}`);
    exitCode = 1;
  } finally {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  }

  process.exit(exitCode);
}

runTests().catch((err) => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
  }
  console.error(err);
  process.exit(1);
});
