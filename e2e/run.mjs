/**
 * End-to-end check of the critical slice in Demo Mode, in a real browser.
 *
 *   npm run web:demo      (in another terminal; serves http://localhost:8081)
 *   npm run e2e:web
 *
 * Flow: enter as AJ → submit yesterday's screenshot (synthetic sample) → it is
 * "Awaiting review" and does not score → review Ben's pending proof → Ben's
 * successful days go up by one → reject Kaan's with a reason → Kaan, viewing
 * as himself, sees the reason. Screenshots land in e2e/.artifacts/.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.E2E_URL ?? 'http://localhost:8081';
const OUT = new URL('./.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const steps = [];
const check = (ok, label) => {
  steps.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) throw new Error(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${name}.png` });
};
const text = (t) => page.getByText(t, { exact: false }).first();

async function standingFor(name) {
  const row = page.getByTestId('standings-list').getByText(name, { exact: true }).first();
  const label = await row.locator('xpath=ancestor::*[@aria-label][1]').getAttribute('aria-label').catch(() => null);
  return label ?? '';
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 180000 });
  await text('Explore the demo').click();
  await text('Submit yesterday’s screenshot').waitFor();
  check(true, 'Home shows "Submit yesterday’s screenshot" for AJ');
  await shot('01-home');

  // 1. Submit proof for yesterday.
  await text('Submit yesterday’s screenshot').click();
  await page.getByTestId('checkin-value-hours').waitFor();
  await shot('02-checkin');
  await page.getByTestId('checkin-value-hours').fill('1');
  await page.getByTestId('checkin-value-minutes').fill('35');
  await page.getByTestId('checkin-use-sample').click();
  await page.getByTestId('checkin-preview').waitFor();
  await page.getByTestId('checkin-submit').click();
  await text('Awaiting review').waitFor({ timeout: 15000 });
  check(true, 'Submission is "Awaiting review" (pending, not counted)');
  await shot('03-submitted');

  // 2. Review queue: approve Ben, reject Kaan.
  // Demo data lives in memory, so move around inside the app (a reload would reset it).
  await page.locator('[data-testid="nav-back"]:visible').last().click();
  await page.getByText(/Review \d+ submissions/).first().waitFor();
  await page.getByText(/Review \d+ submissions/).first().click();
  await page.getByTestId(/^review-card-/).first().waitFor();
  await shot('04-review-queue');
  const cards = page.getByTestId(/^review-card-/);
  const benCard = cards.filter({ hasText: 'Ben' }).first();
  await benCard.getByTestId('review-approve').click();
  await page.waitForTimeout(1200);
  check((await cards.filter({ hasText: 'Ben' }).count()) === 0, 'Approved Ben’s screenshot leaves the queue');

  const kaanCard = cards.filter({ hasText: 'Kaan' }).first();
  await kaanCard.getByTestId('review-reject').click();
  await page.getByTestId('reject-reason').fill('The date isn’t visible.');
  await page.getByTestId('reject-confirm').click();
  await page.waitForTimeout(1200);
  check((await cards.filter({ hasText: 'Kaan' }).count()) === 0, 'Rejected Kaan’s screenshot with a reason');
  await shot('05-after-review');

  // 3. Standings reflect only reviewed days.
  await page.locator('[data-testid="nav-back"]:visible').last().click();
  await page.getByText(/Review \d+ submissions|Resolve a dispute/).first().waitFor();
  await page.locator('[data-testid^="challenge-card-"]:visible').filter({ hasText: 'Screen Time Showdown' }).first().click();
  await page.locator('[data-testid="challenge-tab-standings"]:visible').first().click();
  await page.getByTestId('standings-list').waitFor();
  await shot('06-standings');
  const body = await page.getByTestId('standings-list').innerText();
  check(/Ben[\s\S]*?5\s*\/\s*7/.test(body), 'Ben now has 5 of 7 after approval');
  check(/awaiting review/i.test(body), 'Pending proof is shown separately as "awaiting review"');

  // 4. Kaan sees the rejection reason.
  await page.getByTestId('demo-banner').click();
  await page.getByTestId('demo-persona-kaan').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-activity').click();
  await text('The date isn’t visible.').waitFor({ timeout: 15000 });
  check(true, 'Kaan’s Activity shows the private rejection reason');
  await shot('07-kaan-activity');
} catch (error) {
  steps.push(`ERROR ${error.message.split('\n')[0]}`);
  await page.screenshot({ path: `${OUT}failure.png` }).catch(() => undefined);
} finally {
  await browser.close();
}
console.log(steps.join('\n'));
if (errors.length) console.log('Page errors:\n' + errors.slice(0, 5).join('\n'));
process.exit(steps.some((s) => !s.startsWith('PASS')) || errors.length ? 1 : 0);
