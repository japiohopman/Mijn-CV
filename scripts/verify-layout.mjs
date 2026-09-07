import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PORT = 3099;

if (!fs.existsSync('verification')) {
  fs.mkdirSync('verification');
}

const serverProc = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'inherit'
});

async function waitForServer(url, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('Server timeout');
}

async function run() {
  try {
    await waitForServer(`http://127.0.0.1:${PORT}`);
    console.log('Server started for visual verification');

    const browser = await chromium.launch();

    // Desktop Dark Mode
    const contextDesktop = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const pageDesktop = await contextDesktop.newPage();
    await pageDesktop.goto(`http://127.0.0.1:${PORT}/`);
    await pageDesktop.evaluate(() => {
      document.querySelectorAll('.reveal, .stagger-item').forEach(el => el.classList.add('visible'));
    });
    await pageDesktop.screenshot({ path: 'verification/desktop-dark-full.png', fullPage: true });
    console.log('Captured verification/desktop-dark-full.png');

    // Desktop Light Mode
    await pageDesktop.click('#themeToggle');
    await pageDesktop.screenshot({ path: 'verification/desktop-light-full.png', fullPage: true });
    console.log('Captured verification/desktop-light-full.png');

    // Mobile Viewport (390x844 iPhone 12)
    const contextMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageMobile = await contextMobile.newPage();
    await pageMobile.goto(`http://127.0.0.1:${PORT}/`);
    await pageMobile.evaluate(() => {
      document.querySelectorAll('.reveal, .stagger-item').forEach(el => el.classList.add('visible'));
    });
    await pageMobile.screenshot({ path: 'verification/mobile-dark-full.png', fullPage: true });
    console.log('Captured verification/mobile-dark-full.png');

    await browser.close();
    console.log('Visual verification complete!');
  } finally {
    if (serverProc) serverProc.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Visual verification failed:', err);
  if (serverProc) serverProc.kill('SIGTERM');
  process.exit(1);
});
