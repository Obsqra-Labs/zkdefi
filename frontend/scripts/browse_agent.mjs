/**
 * Browse /agent with Playwright and print visible control-surface content.
 * Run: npx playwright run scripts/browse_agent.mjs (from frontend/)
 * Requires: dev server on port 3001 (npm run dev)
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const AGENT = `${BASE}/agent`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(AGENT, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log('Title:', title);

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const lines = bodyText.split(/\s+/).filter(Boolean);
    const snippet = lines.slice(0, 120).join(' ');
    console.log('Body text (first 120 words):', snippet);

    const checks = ['Control', 'Surface', 'Vault', 'Pool', 'Activity', 'Privacy', 'Brain', 'Trust', 'System', 'Developer'];
    console.log('\nChecks (present in body):');
    for (const s of checks) {
      const ok = bodyText.includes(s);
      console.log('  ', ok ? 'OK' : 'MISS', s);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
