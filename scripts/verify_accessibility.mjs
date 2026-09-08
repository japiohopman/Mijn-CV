import { spawn } from 'child_process';
import { chromium } from 'playwright';

const PORT = 3098;
const BASE_URL = `http://localhost:${PORT}`;

console.log('Starting server for accessibility verification test...');
const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: PORT.toString() },
  stdio: 'inherit'
});

const runTests = async () => {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const browser = await chromium.launch();
    const page = await browser.newPage();

    console.log('\n--- 1. Testing Skip Link & Main Landmark on Homepage ---');
    await page.goto(BASE_URL);
    await page.keyboard.press('Tab');
    const skipLinkText = await page.evaluate(() => document.activeElement.textContent);
    console.log(`Focused element on first Tab: "${skipLinkText}"`);
    if (!skipLinkText.includes('Ga naar hoofdinhoud')) {
      throw new Error('First Tab element is not the skip link!');
    }

    await page.keyboard.press('Enter');
    const focusedIdAfterSkip = await page.evaluate(() => document.activeElement.id);
    console.log(`Focused element ID after pressing Enter on skip link: "${focusedIdAfterSkip}"`);
    if (focusedIdAfterSkip !== 'main-content') {
      throw new Error('Skip link did not move focus to #main-content!');
    }

    console.log('\n--- 2. Testing Navigation Landmark & Aria Attributes ---');
    const navAriaLabel = await page.getAttribute('nav', 'aria-label');
    console.log(`Nav aria-label: "${navAriaLabel}"`);

    const themeTogglePressed = await page.getAttribute('#themeToggle', 'aria-pressed');
    console.log(`Initial themeToggle aria-pressed: "${themeTogglePressed}"`);

    await page.click('#themeToggle');
    const themeTogglePressedAfterClick = await page.getAttribute('#themeToggle', 'aria-pressed');
    console.log(`ThemeToggle aria-pressed after click: "${themeTogglePressedAfterClick}"`);

    console.log('\n--- 3. Testing Mobile Menu Drawer Keyboard & ARIA Controls ---');
    await page.setViewportSize({ width: 390, height: 844 });
    const initialExpanded = await page.getAttribute('#navToggle', 'aria-expanded');
    console.log(`Initial navToggle aria-expanded: "${initialExpanded}"`);

    await page.click('#navToggle');
    const openExpanded = await page.getAttribute('#navToggle', 'aria-expanded');
    console.log(`NavToggle aria-expanded after click: "${openExpanded}"`);
    if (openExpanded !== 'true') {
      throw new Error('navToggle aria-expanded was not set to "true" when opened!');
    }

    await page.keyboard.press('Escape');
    const closedExpanded = await page.getAttribute('#navToggle', 'aria-expanded');
    console.log(`NavToggle aria-expanded after pressing Escape: "${closedExpanded}"`);
    if (closedExpanded !== 'false') {
      throw new Error('Mobile menu did not close on Escape key press!');
    }

    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n--- 4. Testing Copy Button Feedback and Live Regions ---');
    const copyEmailBtn = await page.$('#copyEmailBtn');
    if (copyEmailBtn) {
      await copyEmailBtn.click();
      const feedbackText = await page.textContent('#copyEmailBtn');
      console.log(`Copy email button text after click: "${feedbackText.trim()}"`);
    }

    console.log('\n--- 5. Testing Share Page Accessibility ---');
    await page.goto(`${BASE_URL}/share`);
    const copyLinkBtn = await page.$('#copyLinkBtn');
    if (copyLinkBtn) {
      await copyLinkBtn.click();
      const shareCopyText = await page.textContent('#copyLinkBtn');
      console.log(`Share page copy button text after click: "${shareCopyText.trim()}"`);
    }

    console.log('\n--- 6. Testing Kitchen CV Page Accessibility ---');
    await page.goto(`${BASE_URL}/keuken-cv`);
    const printBtnLabel = await page.getAttribute('button[onclick="window.print()"]', 'aria-label');
    console.log(`Kitchen CV print button aria-label: "${printBtnLabel}"`);

    console.log('\n--- 7. Auditing Form Fields & Accessibility Labels ---');
    await page.goto(BASE_URL);
    const formErrors = await page.evaluate(() => {
      const issues = [];
      const inputs = document.querySelectorAll('input, select, textarea');
      inputs.forEach((input) => {
        if (input.type === 'hidden' || input.closest('[aria-hidden="true"]')) return;
        const id = input.id;
        const label = id ? document.querySelector(`label[for="${id}"]`) : null;
        const ariaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        if (!label && !ariaLabel) {
          issues.push(`Input #${id || input.name} missing accessible label`);
        }
      });
      return issues;
    });

    if (formErrors.length > 0) {
      console.error('Form accessibility issues:', formErrors);
      throw new Error('Form fields failed accessibility audit');
    } else {
      console.log('✓ All visible form controls have associated <label> elements');
    }

    await browser.close();
    console.log('\n✓ Accessibility Verification Test Passed Successfully!');
  } catch (err) {
    console.error('\n✗ Accessibility Verification Test Failed:', err);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
};

runTests();
