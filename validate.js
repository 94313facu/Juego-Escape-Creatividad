const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER_LOG', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  page.on('requestfailed', req => {
    const failure = req.failure();
    console.log('REQFAILED', req.url(), failure && failure.errorText);
  });

  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  console.log('TITLE:', await page.title());
  console.log('BODY_SNIPPET:', (await page.locator('body').innerText()).slice(0, 700));
  await page.screenshot({ path: 'test-shot.png', fullPage: true });
  await browser.close();
})();
