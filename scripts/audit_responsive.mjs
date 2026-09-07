import { spawn } from 'child_process';
import { chromium } from 'playwright';
import fs from 'fs';

if (!fs.existsSync('verification')) {
  fs.mkdirSync('verification');
}

const server = spawn('node', ['server.js'], { stdio: 'inherit' });

setTimeout(async () => {
  try {
    const browser = await chromium.launch();
    const viewports = [
      { name: '375px', width: 375, height: 812 },
      { name: '390px', width: 390, height: 844 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
      { name: '1920px', width: 1920, height: 1080 }
    ];

    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto('http://localhost:3000/');

      // Force reveal animations so full content is visible in screenshot
      await page.evaluate(() => {
        document.querySelectorAll('.reveal, .stagger-item').forEach(el => el.classList.add('active'));
      });
      await page.waitForTimeout(300);

      await page.screenshot({ path: `verification/index-${vp.name}.png`, fullPage: true });

      const navToggle = await page.$('#navToggle');
      if (navToggle && await navToggle.isVisible()) {
        await navToggle.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `verification/nav-open-${vp.name}.png` });
      }

      await page.goto('http://localhost:3000/share');
      await page.evaluate(() => {
        document.querySelectorAll('.reveal, .stagger-item').forEach(el => el.classList.add('active'));
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `verification/share-${vp.name}.png`, fullPage: true });

      await page.goto('http://localhost:3000/keuken-cv');
      await page.evaluate(() => {
        document.querySelectorAll('.reveal, .stagger-item').forEach(el => el.classList.add('active'));
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `verification/keuken-cv-${vp.name}.png`, fullPage: true });

      await page.close();
    }

    await browser.close();
    console.log('Screenshots saved successfully in verification/');
  } catch (err) {
    console.error('Audit script error:', err);
  } finally {
    server.kill();
    process.exit(0);
  }
}, 1500);
