const { spawn } = require('child_process');
const http = require('http');

console.log('Testing Express server routes, static assets, and SEO OpenGraph meta tags...');

const PORT = process.env.TEST_PORT || 3099;

const serverProc = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function fetchRoute(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
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
      const res = await fetchRoute('/');
      if (res.statusCode === 200) return true;
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
        const { statusCode } = await fetchRoute(path);
        if (statusCode === expectedStatus) {
          console.log(`✓ GET ${path} -> Status ${statusCode} (expected ${expectedStatus})`);
        } else {
          console.error(`✗ GET ${path} -> Status ${statusCode} (expected ${expectedStatus})`);
          success = false;
        }
      } catch (err) {
        console.error(`✗ GET ${path} -> Error: ${err.message}`);
        success = false;
      }
    }

    // SEO & OpenGraph Meta Tags Assertions
    const metaTestCases = [
      {
        path: '/',
        checks: [
          '<title>Jaap Hopman | Creative Developer CV</title>',
          'property="og:title" content="Jaap Hopman | Creative Developer CV"',
          'property="og:description" content="Visueel en interactief CV van Jaap Hopman',
          'property="og:image" content="http://127.0.0.1:3099/images/jaap-Hopman.jpg"',
          'property="og:url" content="http://127.0.0.1:3099/"',
          'name="twitter:card" content="summary_large_image"',
          'rel="canonical" href="http://127.0.0.1:3099/"'
        ]
      },
      {
        path: '/share',
        checks: [
          '<title>Deel CV | Jaap Hopman</title>',
          'property="og:title" content="Deel CV | Jaap Hopman"',
          'property="og:description" content="Deel of bekijk het interactieve portfolio',
          'property="og:image" content="http://127.0.0.1:3099/images/jaap-Hopman.jpg"',
          'property="og:url" content="http://127.0.0.1:3099/share"',
          'name="twitter:card" content="summary_large_image"',
          'rel="canonical" href="http://127.0.0.1:3099/share"'
        ]
      },
      {
        path: '/keuken-cv',
        checks: [
          '<title>Keuken CV | Jaap Hopman</title>',
          'property="og:title" content="Keuken CV | Jaap Hopman"',
          'property="og:description" content="Culinair profiel &amp; Horeca-ervaring',
          'property="og:image" content="http://127.0.0.1:3099/images/jaap-Hopman.jpg"',
          'property="og:url" content="http://127.0.0.1:3099/keuken-cv"',
          'name="twitter:card" content="summary_large_image"',
          'rel="canonical" href="http://127.0.0.1:3099/keuken-cv"'
        ]
      }
    ];

    console.log('\nChecking SEO & OpenGraph Meta Tags...');
    for (const { path, checks } of metaTestCases) {
      try {
        const { statusCode, body } = await fetchRoute(path);
        if (statusCode !== 200) {
          console.error(`✗ SEO check ${path} failed: status ${statusCode}`);
          success = false;
          continue;
        }

        let routePassed = true;
        for (const expectedSnippet of checks) {
          if (body.includes(expectedSnippet)) {
            console.log(`  ✓ ${path} contains: ${expectedSnippet}`);
          } else {
            console.error(`  ✗ ${path} missing expected snippet: ${expectedSnippet}`);
            routePassed = false;
            success = false;
          }
        }
      } catch (err) {
        console.error(`✗ SEO check ${path} error: ${err.message}`);
        success = false;
      }
    }

    if (!success) {
      exitCode = 1;
    } else {
      console.log('\nAll Express route, asset, and SEO OpenGraph tests passed successfully!');
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
