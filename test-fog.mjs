import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  
  // Track long requests
  const reqStart = new Map();
  page.on('request', request => {
    reqStart.set(request.url(), Date.now());
  });
  page.on('response', response => {
    const start = reqStart.get(response.url());
    if (start) {
      const dur = Date.now() - start;
      if (dur > 500) {
        console.log(`REQ: ${dur}ms - ${response.url()}`);
      }
    }
  });

  console.log('Navigating...');
  await page.goto('https://privatesecure.org/');
  
  console.log('Clicking Create New Wallet...');
  await page.getByText('Create New Wallet').click();
  
  // Wait for 70 seconds to let the fog sync finish
  console.log('Waiting for wallet creation to complete...');
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(1000);
    if (i % 10 === 0) console.log(`${i}s passed...`);
  }

  await browser.close();
})();
