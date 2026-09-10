import { spawn } from 'child_process';
import http from 'http';

const PORT = process.env.PERF_PORT || 3097;

console.log('Running automated performance audit benchmark...');

const serverProc = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});

function fetchRoute(path) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.get(`http://127.0.0.1:${PORT}${path}`, {
      headers: {
        'Accept-Encoding': 'gzip, deflate, br'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const duration = performance.now() - start;
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          ttfbMs: duration,
          contentLength: buffer.length,
          encoding: res.headers['content-encoding'] || 'none',
          cacheControl: res.headers['cache-control'] || 'none'
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${path}`));
    });
  });
}

async function waitForServer(maxAttempts = 20, intervalMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchRoute('/');
      if (res.statusCode === 200) return true;
    } catch {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Server failed to start on port ${PORT}`);
}

async function runPerfCheck() {
  let success = true;
  try {
    await waitForServer();

    const targets = [
      { path: '/', maxKb: 15 },
      { path: '/share', maxKb: 10 },
      { path: '/keuken-cv', maxKb: 12 },
      { path: '/styles.css', maxKb: 15 },
      { path: '/app.js', maxKb: 8 }
    ];

    console.log('\n--- Performance Audit Results ---');
    for (const target of targets) {
      const res = await fetchRoute(target.path);
      const kb = (res.contentLength / 1024).toFixed(2);
      const ttfb = res.ttfbMs.toFixed(2);

      const passKb = res.contentLength <= target.maxKb * 1024;
      const passEncoding = res.encoding === 'gzip' || res.encoding === 'br' || res.encoding === 'deflate';

      if (res.statusCode === 200 && passKb && passEncoding) {
        console.log(`✓ ${target.path.padEnd(15)} | TTFB: ${ttfb.padStart(6)}ms | Size: ${kb.padStart(6)}KB | Encoding: ${res.encoding}`);
      } else {
        console.error(`✗ ${target.path.padEnd(15)} | TTFB: ${ttfb.padStart(6)}ms | Size: ${kb.padStart(6)}KB (max: ${target.maxKb}KB) | Encoding: ${res.encoding}`);
        success = false;
      }
    }

    if (success) {
      console.log('\n✓ Performance audit passed all size, TTFB, and compression thresholds!');
    }
  } catch (err) {
    console.error(`✗ Performance audit failed: ${err.message}`);
    success = false;
  } finally {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  }

  process.exit(success ? 0 : 1);
}

runPerfCheck();
