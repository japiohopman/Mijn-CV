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

function postJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
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
      { path: '/robots.txt', expectedStatus: 200 },
      { path: '/sitemap.xml', expectedStatus: 200 },
      { path: '/github_action.png', expectedStatus: 200 },
      { path: '/styles.css', expectedStatus: 200 },
      { path: '/app.js', expectedStatus: 200 },
      { path: '/favicon.svg', expectedStatus: 200 },
      { path: '/favicon.ico', expectedStatus: 200 },
      { path: '/apple-touch-icon.png', expectedStatus: 200 },
      { path: '/site.webmanifest', expectedStatus: 200 },
      { path: '/secretary-engine.js', expectedStatus: 200 },
      { path: '/secretary-ui.js', expectedStatus: 200 },
      { path: '/data/secretary_knowledge.json', expectedStatus: 200 },
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

    // SEO, OpenGraph & Structured Data (JSON-LD) Meta Assertions
    const metaTestCases = [
      {
        path: '/',
        checks: [
          '<title>Jaap Hopman | Creative Developer CV</title>',
          'property="og:title" content="Jaap Hopman | Creative Developer CV"',
          'property="og:description" content="Visueel en interactief CV van Jaap Hopman',
          'property="og:image" content="http://127.0.0.1:3099/images/jaap-Hopman.jpg"',
          'property="og:image:width" content="1200"',
          'property="og:image:height" content="630"',
          'href="/favicon.svg"',
          'href="/site.webmanifest"',
          'property="og:url" content="http://127.0.0.1:3099/"',
          'name="twitter:card" content="summary_large_image"',
          'name="robots" content="index, follow"',
          'rel="canonical" href="http://127.0.0.1:3099/"',
          '"@type": "Person"',
          '"name": "Jaap Hopman"',
          '"jobTitle": "Developer & Creative Technologist"',
          '"@type": "WebSite"',
          '"@type": "ProfilePage"',
          'href="/keuken-cv"',
          'id="secretaryWidget"',
          'src="/secretary-ui.js"'
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
          'rel="canonical" href="http://127.0.0.1:3099/share"',
          '"@type": "Person"',
          'id="secretaryWidget"'
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
          'rel="canonical" href="http://127.0.0.1:3099/keuken-cv"',
          '"jobTitle": "Zelfstandig Werkend Kok & Chef"',
          'Twee Werelden, Eén Executiementaliteit',
          'Bekijk Developer Portfolio',
          'id="secretaryWidget"'
        ]
      },
      {
        path: '/robots.txt',
        checks: [
          'User-agent: *',
          'Allow: /',
          'Sitemap:'
        ]
      },
      {
        path: '/sitemap.xml',
        checks: [
          '<loc>https://jaaphopman.com/</loc>',
          '<loc>https://jaaphopman.com/share</loc>',
          '<loc>https://jaaphopman.com/keuken-cv</loc>'
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

    console.log('\nChecking Contact API endpoint (/api/contact)...');

    // Test 1: Valid submission
    const validRes = await postJSON('/api/contact', {
      name: 'Test Afzender',
      email: 'test@example.com',
      subject: 'Freelance Opdracht / Project',
      message: 'Dit is een testbericht voor de contact experience.'
    });
    if (validRes.statusCode === 200 && validRes.json && validRes.json.success === true) {
      console.log('  ✓ Valid contact submission returned HTTP 200 with success JSON');
    } else {
      console.error(`  ✗ Valid contact submission failed: status ${validRes.statusCode}`);
      success = false;
    }

    // Test 2: Missing fields
    const invalidRes = await postJSON('/api/contact', {
      name: '',
      email: 'invalid-email',
      message: ''
    });
    if (invalidRes.statusCode === 400 && invalidRes.json && invalidRes.json.success === false) {
      console.log('  ✓ Invalid/missing fields contact submission returned HTTP 400 error JSON');
    } else {
      console.error(`  ✗ Invalid contact submission check failed: status ${invalidRes.statusCode}`);
      success = false;
    }

    // Test 3: Anti-spam honeypot
    const spamRes = await postJSON('/api/contact', {
      name: 'Bot User',
      email: 'spammer@bot.com',
      message: 'Buy cheap watches',
      website_url: 'http://spam.com'
    });
    if (spamRes.statusCode === 200 && spamRes.json && spamRes.json.success === true) {
      console.log('  ✓ Honeypot spam submission handled silently with HTTP 200');
    } else {
      console.error(`  ✗ Honeypot spam submission check failed: status ${spamRes.statusCode}`);
      success = false;
    }

    console.log('\nChecking Privacy & Zero Client-Side Tracking Assertions...');
    const forbiddenTrackerDomains = [
      'google-analytics.com',
      'googletagmanager.com',
      'hotjar.com',
      'connect.facebook.net',
      'mixpanel.com',
      'segment.com'
    ];

    for (const routePath of ['/', '/share', '/keuken-cv']) {
      try {
        const { statusCode, body } = await fetchRoute(routePath);
        if (statusCode !== 200) {
          console.error(`  ✗ Privacy assertion check failed on ${routePath}: status ${statusCode}`);
          success = false;
          continue;
        }

        let trackerFound = false;
        for (const domain of forbiddenTrackerDomains) {
          if (body.includes(domain)) {
            console.error(`  ✗ Forbidden tracking domain "${domain}" found in ${routePath}!`);
            trackerFound = true;
            success = false;
          }
        }

        if (!trackerFound) {
          console.log(`  ✓ ${routePath} confirmed clean of third-party tracking scripts`);
        }
      } catch (err) {
        console.error(`  ✗ Privacy check error on ${routePath}: ${err.message}`);
        success = false;
      }
    }

    if (!success) {
      exitCode = 1;
    } else {
      console.log('\nAll Express route, asset, SEO OpenGraph, Contact API, and Privacy assertions passed successfully!');
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
