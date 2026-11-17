/**
 * Screenshot tour of the Demo Mode app, for visual review.
 *
 *   node e2e/screens.mjs 390x844 docs/screenshots
 *   node e2e/screens.mjs 320x568 docs/screenshots/compact
 *
 * Needs the demo web build at E2E_URL (default http://localhost:8081).
 * Walks the app by clicking inside it (demo data lives in memory, so no
 * reloads or deep links after the first goto). Each screen is attempted
 * twice; a screen that cannot be reached is reported as skipped, never faked.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [size = '390x844', outArg = 'docs/screenshots'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const BASE = process.env.E2E_URL ?? 'http://localhost:8081';
const OUT = resolve(process.cwd(), outArg);
mkdirSync(OUT, { recursive: true });

const report = [];
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const vis = (selector) => page.locator(`${selector}:visible`).first();
const visText = (text) => page.getByText(text).filter({ visible: true }).first();

async function shot(name) {
  await sleep(900);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  report.push(`SAVED ${name}`);
}

/** Runs one screen's navigation twice; records skip with reason if both fail. */
async function step(name, fn) {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      return true;
    } catch (e) {
      last = e.message.split('\n')[0];
    }
  }
  report.push(`SKIPPED ${name}: ${last}`);
  return false;
}

/** Pops every stacked (non-tab) screen until the tab bar is in charge. */
async function backToTabs() {
  for (let i = 0; i < 6; i++) {
    const back = page.locator('[data-testid="nav-back"]:visible').last();
    if ((await back.count()) === 0) return;
    await back.click().catch(() => undefined);
    await sleep(500);
  }
}

async function goTab(tab) {
  await vis(`[data-testid="tab-${tab}"]`).click();
  await sleep(700);
}

async function openChallenge(name) {
  await goTab('circles');
  await vis('[data-testid^="circle-card-"]').click({ timeout: 8000 }).catch(async () => {
    await visText('The Inner Circle').click();
  });
  await vis('[data-testid="circle-overview"]').waitFor({ timeout: 8000 });
  await page.locator('[data-testid^="challenge-card-"]:visible').filter({ hasText: name }).first().click({ timeout: 8000 });
  await visText('Progress').waitFor({ timeout: 8000 });
  await sleep(600);
}

try {
  // 01 + 21: Welcome, then sign-up before entering the demo.
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 180000 });
  await vis('[data-testid="welcome-screen"]').waitFor({ timeout: 60000 });
  await step('01-welcome', async () => {
    await shot('01-welcome');
  });
  await step('21-sign-up', async () => {
    await vis('[data-testid="welcome-create-account"]').click();
    await vis('[data-testid="sign-up-email"]').waitFor({ timeout: 8000 });
    await shot('21-sign-up');
    await vis('[data-testid="nav-back"]').click({ timeout: 4000 }).catch(() => page.goBack());
    await vis('[data-testid="welcome-explore-demo"]').waitFor({ timeout: 8000 });
  });

  // Enter the demo as AJ (admin of Screen Time Showdown).
  await vis('[data-testid="welcome-explore-demo"]').click();
  await visText('Submit yesterday’s screenshot').waitFor({ timeout: 15000 });
  await step('02-home', () => shot('02-home'));

  await step('03-circles', async () => {
    await goTab('circles');
    await vis('[data-testid="circles-screen"]').waitFor({ timeout: 8000 });
    await shot('03-circles');
  });

  await step('04-circle-overview', async () => {
    await vis('[data-testid^="circle-card-"]').click({ timeout: 8000 });
    await vis('[data-testid="circle-overview"]').waitFor({ timeout: 8000 });
    await shot('04-circle-overview');
  });

  await step('05-circle-members', async () => {
    await vis('[aria-label="Members and invites"]').click({ timeout: 8000 });
    await vis('[data-testid="members-screen"]').waitFor({ timeout: 8000 });
    await shot('05-circle-members');
    await backToTabs();
  });

  // Circle overview is a pushed screen; go back to circles and into the challenge.
  await step('06-challenge-progress', async () => {
    await openChallenge('Screen Time Showdown');
    await shot('06-challenge-progress');
  });

  await step('07-challenge-standings', async () => {
    await visText('Standings').click();
    await vis('[data-testid="standings-list"]').waitFor({ timeout: 8000 });
    await shot('07-challenge-standings');
  });

  await step('08-challenge-rules', async () => {
    await visText('Rules').click();
    await sleep(800);
    await shot('08-challenge-rules');
  });

  await step('19-reward-demo', async () => {
    await vis('[data-testid="challenge-reward"]').click({ timeout: 4000 });
    await sleep(1000);
    await shot('18-reward-demo');
    await backToTabs();
  });

  await step('17-results', async () => {
    await backToTabs();
    await goTab('circles');
    await vis('[data-testid^="circle-card-"]').click({ timeout: 8000 });
    await page.locator('[data-testid^="challenge-card-"]:visible').filter({ hasText: 'Morning Miles' }).first().click({ timeout: 8000 });
    await visText('See results').click({ timeout: 8000 });
    await vis('[data-testid="results-screen"]').waitFor({ timeout: 8000 });
    await shot('17-results');
  });
  await backToTabs();

  // 09 AJ's check-in, from the Home action.
  await step('09-checkin', async () => {
    await goTab('index');
    await visText('Submit yesterday’s screenshot').click();
    await vis('[data-testid="checkin-value-hours"]').waitFor({ timeout: 8000 });
    await shot('09-checkin');
  });
  await backToTabs();

  // 11 review queue, then 10 a day detail opened from it.
  await step('11-review-queue', async () => {
    await goTab('index');
    await visText(/Review \d+ submissions/).click({ timeout: 8000 });
    await vis('[data-testid^="review-card-"]').waitFor({ timeout: 8000 });
    await shot('11-review-queue');
  });
  await step('10-day-detail', async () => {
    await visText('Open day').click({ timeout: 8000 });
    await sleep(1200);
    if (!page.url().includes('/day')) throw new Error('did not reach day detail');
    await shot('10-day-detail');
  });
  await backToTabs();

  // 12 admin console and 13 change history, via the challenge's Admin tools.
  await step('12-admin-console', async () => {
    await openChallenge('Screen Time Showdown');
    await vis('[aria-label="Admin tools"]').click({ timeout: 8000 });
    await visText('Change history').waitFor({ timeout: 8000 });
    await shot('12-admin-console');
  });
  await step('13-change-history', async () => {
    await vis('[data-testid="admin-history-link"]').click({ timeout: 8000 });
    await sleep(1000);
    await shot('13-change-history');
  });
  await backToTabs();

  await step('14-activity', async () => {
    await goTab('activity');
    await vis('[data-testid="activity-screen"]').waitFor({ timeout: 8000 });
    await shot('14-activity');
  });

  await step('15-profile', async () => {
    await goTab('profile');
    await vis('[data-testid="profile-screen"]').waitFor({ timeout: 8000 });
    await shot('15-profile');
  });
  await step('20-design-lab', async () => {
    await vis('[data-testid="profile-design-lab"]').click({ timeout: 8000 });
    await sleep(1200);
    await shot('20-design-lab');
    await backToTabs();
  });

  await step('16-new-challenge-wizard', async () => {
    await goTab('index');
    await vis('[data-testid="home-create-challenge"]').click({ timeout: 8000 });
    await vis('[data-testid="wizard-name"], [data-testid="wizard-step"]').first().waitFor({ timeout: 8000 });
    await shot('16-new-challenge-wizard');
    await backToTabs();
  });

  await step('22-demo-controls', async () => {
    await goTab('index');
    await vis('[data-testid="demo-banner"]').click({ timeout: 8000 });
    await vis('[data-testid="demo-tools"]').waitFor({ timeout: 8000 });
    await shot('19-demo-controls');
  });
} catch (error) {
  report.push(`FATAL ${error.message.split('\n')[0]}`);
} finally {
  await browser.close();
}

console.log(report.join('\n'));
if (errors.length) console.log('Page errors:\n' + errors.slice(0, 5).join('\n'));
