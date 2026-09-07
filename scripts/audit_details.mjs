import { spawn } from 'child_process';
import { chromium } from 'playwright';

const server = spawn('node', ['server.js'], { stdio: 'inherit' });

setTimeout(async () => {
  try {
    const browser = await chromium.launch();
    const viewports = [
      { name: '375px', width: 375, height: 812 },
      { name: '390px', width: 390, height: 844 },
      { name: '768px', width: 768, height: 1024 },
      { name: '880px', width: 880, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
      { name: '1920px', width: 1920, height: 1080 }
    ];

    for (const vp of viewports) {
      console.log(`\n=================== AUDITING VIEWPORT ${vp.name} (${vp.width}px) ===================`);
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto('http://localhost:3000/');

      const report = await page.evaluate(() => {
        const issues = [];

        // 1. Check Nav bar fit
        const nav = document.querySelector('.nav');
        if (nav) {
          const navRect = nav.getBoundingClientRect();
          const logo = document.querySelector('.logo');
          const navMenu = document.querySelector('.nav-menu');
          const navActions = document.querySelector('.nav-actions');

          if (navMenu && getComputedStyle(navMenu).display !== 'none' && getComputedStyle(navMenu).position !== 'fixed') {
            const menuRect = navMenu.getBoundingClientRect();
            const actionsRect = navActions ? navActions.getBoundingClientRect() : { left: 0 };
            if (menuRect.right > actionsRect.left - 5) {
              issues.push(`NAV OVERLAP: navMenu right (${menuRect.right}px) collides with navActions left (${actionsRect.left}px)`);
            }
          }
        }

        // 2. Check Touch Targets (< 44px height or width)
        const interactiveSelectors = 'a, button, input, textarea, select, summary, [tabindex="0"]';
        const interactiveEls = document.querySelectorAll(interactiveSelectors);
        const smallTouchTargets = [];
        interactiveEls.forEach(el => {
          // Only check visible elements
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            if (rect.width < 44 || rect.height < 44) {
              // Ignore inline links inside text paragraphs
              const isInlineLink = el.tagName === 'A' && el.closest('p, li, span') && style.display === 'inline';
              if (!isInlineLink) {
                smallTouchTargets.push({
                  tag: el.tagName,
                  class: el.className,
                  id: el.id,
                  text: (el.textContent || '').trim().substring(0, 20),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                });
              }
            }
          }
        });
        if (smallTouchTargets.length > 0) {
          issues.push(`SMALL TOUCH TARGETS (${smallTouchTargets.length}): ` + JSON.stringify(smallTouchTargets.slice(0, 8)));
        }

        // 3. Check Image Overflow & Sizing
        const images = document.querySelectorAll('img');
        const imgIssues = [];
        images.forEach(img => {
          const rect = img.getBoundingClientRect();
          const parentRect = img.parentElement ? img.parentElement.getBoundingClientRect() : rect;
          if (rect.width > parentRect.width + 1) {
            imgIssues.push(`IMG OVERFLOW: ${img.src} width (${rect.width}px) > parent width (${parentRect.width}px)`);
          }
        });
        if (imgIssues.length > 0) {
          issues.push(...imgIssues);
        }

        // 4. Check Horizontal Scroll on Container / Shell
        const docWidth = document.documentElement.clientWidth;
        const containers = document.querySelectorAll('.container, .page-shell, section, .hero, .footer');
        containers.forEach(c => {
          const rect = c.getBoundingClientRect();
          if (rect.right > docWidth + 1 || rect.left < -1) {
            issues.push(`CONTAINER OVERFLOW: ${c.className || c.tagName} bounds [${rect.left}, ${rect.right}] exceed viewport (${docWidth})`);
          }
        });

        // 5. Gallery Thumbnail checks
        const thumbBtns = document.querySelectorAll('.thumb-btn');
        thumbBtns.forEach(btn => {
          const rect = btn.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            issues.push(`GALLERY THUMB SMALL: ${btn.className} size ${Math.round(rect.width)}x${Math.round(rect.height)}px`);
          }
        });

        return issues;
      });

      if (report.length === 0) {
        console.log(`✓ No layout issues detected on / @ ${vp.name}`);
      } else {
        report.forEach(i => console.log(`! [${vp.name}] ${i}`));
      }

      await page.close();
    }

    await browser.close();
  } catch (err) {
    console.error(err);
  } finally {
    server.kill();
    process.exit(0);
  }
}, 1500);
