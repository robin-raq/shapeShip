import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = 'http://localhost:5173';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login first
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', 'alice.chen@ship.local');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/docs**', { timeout: 10000 });
  // Dismiss action items modal if present
  await page.evaluate(() => localStorage.setItem('ship:disableActionItemsModal', 'true'));

  const pages = [
    { name: 'Login', path: '/login', skipAuth: true },
    { name: 'Documents', path: '/docs' },
    { name: 'Issues', path: '/issues' },
    { name: 'Projects', path: '/projects' },
    { name: 'Programs', path: '/programs' },
    { name: 'Team', path: '/team/allocation' },
  ];

  const results: Record<string, any> = {};

  for (const p of pages) {
    if (p.skipAuth) {
      const loginPage = await context.newPage();
      await loginPage.goto(`${BASE}${p.path}`);
      await loginPage.waitForLoadState('networkidle');
      const axeResults = await new AxeBuilder({ page: loginPage }).analyze();
      results[p.name] = {
        violations: axeResults.violations.length,
        passes: axeResults.passes.length,
        incomplete: axeResults.incomplete.length,
        critical: axeResults.violations.filter(v => v.impact === 'critical').length,
        serious: axeResults.violations.filter(v => v.impact === 'serious').length,
        moderate: axeResults.violations.filter(v => v.impact === 'moderate').length,
        minor: axeResults.violations.filter(v => v.impact === 'minor').length,
        details: axeResults.violations.map(v => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
          help: v.help,
        })),
      };
      await loginPage.close();
      continue;
    }

    await page.goto(`${BASE}${p.path}`);
    await page.waitForLoadState('networkidle');
    // Dismiss modals
    try {
      const dialog = page.locator('[role="dialog"] button:last-child');
      if (await dialog.isVisible({ timeout: 1000 })) {
        await dialog.click();
      }
    } catch {}

    await page.waitForTimeout(500);

    const axeResults = await new AxeBuilder({ page }).analyze();
    results[p.name] = {
      violations: axeResults.violations.length,
      passes: axeResults.passes.length,
      incomplete: axeResults.incomplete.length,
      critical: axeResults.violations.filter(v => v.impact === 'critical').length,
      serious: axeResults.violations.filter(v => v.impact === 'serious').length,
      moderate: axeResults.violations.filter(v => v.impact === 'moderate').length,
      minor: axeResults.violations.filter(v => v.impact === 'minor').length,
      details: axeResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.length,
        help: v.help,
      })),
    };
  }

  // Print results
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
