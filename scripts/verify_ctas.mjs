import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';

const PORT = 3088;
const verificationDir = path.resolve('verification');
mkdirSync(verificationDir, { recursive: true });

async function waitForServer(url, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server at ${url} failed to start.`);
}

async function run() {
  console.log('Starting server for Playwright visual verification...');
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  try {
    await waitForServer(`http://localhost:${PORT}/`);
    console.log('Server running on port', PORT);

    const browser = await chromium.launch({ headless: true });

    // Desktop verification
    const pageDesktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await pageDesktop.goto(`http://localhost:${PORT}/`);

    // Force reveals to be visible for screenshotting
    await pageDesktop.evaluate(() => {
      document.querySelectorAll('.reveal, .stagger-item').forEach((el) => el.classList.add('visible'));
    });

    await pageDesktop.screenshot({ path: path.join(verificationDir, 'desktop_hero_dark.png') });

    // Scroll to project CTA banner & footer
    await pageDesktop.locator('#projecten').scrollIntoViewIfNeeded();
    await pageDesktop.waitForTimeout(300);
    await pageDesktop.screenshot({ path: path.join(verificationDir, 'desktop_projects_cta.png') });

    await pageDesktop.locator('#contact').scrollIntoViewIfNeeded();
    await pageDesktop.waitForTimeout(300);
    await pageDesktop.screenshot({ path: path.join(verificationDir, 'desktop_footer_cta.png') });

    // Switch to Light Theme and capture
    await pageDesktop.click('#themeToggle');
    await pageDesktop.waitForTimeout(300);
    await pageDesktop.screenshot({ path: path.join(verificationDir, 'desktop_footer_cta_light.png') });

    // Mobile verification (375x812)
    const pageMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.evaluate(() => {
      document.querySelectorAll('.reveal, .stagger-item').forEach((el) => el.classList.add('visible'));
    });

    await pageMobile.screenshot({ path: path.join(verificationDir, 'mobile_hero.png') });

    await pageMobile.locator('#contact').scrollIntoViewIfNeeded();
    await pageMobile.waitForTimeout(300);
    await pageMobile.screenshot({ path: path.join(verificationDir, 'mobile_footer.png') });

    // Share page
    await pageMobile.goto(`http://localhost:${PORT}/share`);
    await pageMobile.screenshot({ path: path.join(verificationDir, 'mobile_share.png') });

    await browser.close();
    console.log('Successfully generated verification screenshots in verification/');
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
