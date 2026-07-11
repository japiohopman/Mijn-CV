import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await context.new_page()

        # Load the HTML file
        path = os.path.abspath("index.html")
        print(f"Navigating to {path}...")
        await page.goto(f"file://{path}")
        await page.wait_for_load_state("networkidle")

        # Take screenshot of the Chess.com card in the profile section
        # The card is in #over section
        await page.evaluate("document.querySelector('#over').scrollIntoView()")
        await page.wait_for_timeout(500)

        screenshot_path = "/home/jules/verification/chess_card.png"
        print(f"Saving chess card screenshot to {screenshot_path}...")
        await page.screenshot(path=screenshot_path)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
