import asyncio
from playwright.async_api import async_playwright
import subprocess
import time
import os

async def capture_about_section():
    # Start server
    env = os.environ.copy()
    env["PORT"] = "3000"
    server = subprocess.Popen(["node", "server.js"], env=env)
    time.sleep(2)  # Wait for server to boot

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            # Desktop verification
            desktop_context = await browser.new_context(viewport={"width": 1280, "height": 900})
            desktop_page = await desktop_context.new_page()
            await desktop_page.goto("http://localhost:3000/")
            await desktop_page.wait_for_load_state("networkidle")

            # Reveal elements and scroll to element bounding box
            element = await desktop_page.query_selector('#over')
            await desktop_page.evaluate("""() => {
                document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
            }""")
            await element.screenshot(path="verification/about_section_desktop.png")
            print("Desktop screenshot saved to verification/about_section_desktop.png")

            # Mobile verification
            mobile_context = await browser.new_context(viewport={"width": 390, "height": 844})
            mobile_page = await mobile_context.new_page()
            await mobile_page.goto("http://localhost:3000/")
            await mobile_page.wait_for_load_state("networkidle")

            mobile_element = await mobile_page.query_selector('#over')
            await mobile_page.evaluate("""() => {
                document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
            }""")
            await mobile_element.screenshot(path="verification/about_section_mobile.png")
            print("Mobile screenshot saved to verification/about_section_mobile.png")

            await browser.close()
    finally:
        server.terminate()
        server.wait()

if __name__ == "__main__":
    asyncio.run(capture_about_section())
