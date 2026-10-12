const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

async function run() {
  const base = process.env.ACCOUNTS_TEST_URL || 'http://127.0.0.1:8083';
  const origin = new URL(base).origin;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, colorScheme: 'dark', serviceWorkers: 'block' });
  const task = { id: 'regression-task', title: 'Synthetic completion gate', notes: '', status: 'needsAction', etag: 'regression-v1' };
  let patches = 0;
  const blocked = [];
  try {
    await context.addInitScript(() => {
      if (location.origin === 'null') return;
      localStorage.setItem('reminders-google-client-id', '123456789012-abcdefghijklmnop.apps.googleusercontent.com');
      window.__testScopes = [];
      window.google = { accounts: { oauth2: {
        initTokenClient(config) { return { requestAccessToken() {
          window.__testScopes.push(config.scope);
          queueMicrotask(() => config.callback({ access_token: 'synthetic-regression-token', scope: config.scope, expires_in: 3600 }));
        } }; },
      } } };
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      let body;
      if (url.origin === 'https://www.googleapis.com') {
        if (url.pathname === '/tasks/v1/users/@me/lists') body = { items: [{ id: 'regression-list', title: 'Synthetic Tasks' }] };
        else if (url.pathname === '/tasks/v1/lists/regression-list/tasks') body = { items: [task] };
        else if (url.pathname === '/tasks/v1/lists/regression-list/tasks/regression-task') {
          if (request.method() === 'PATCH') {
            assert.deepEqual(JSON.parse(request.postData()), { status: 'completed' });
            assert.equal(request.headers()['if-match'], task.etag);
            patches++;
            task.status = 'completed'; task.completed = '2026-10-12T10:00:00.000Z';
          }
          body = task;
        }
      }
      if (!body) { blocked.push(url.origin + url.pathname); return route.abort(); }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const savedTask = () => page.evaluate(() => JSON.parse(localStorage.getItem('reminders-web-v1')).reminders.find(row => row.title === 'Synthetic completion gate'));
    async function accounts() {
      const homeMore = page.locator('[data-ui="home-toolbar"] [aria-label="More"]');
      if (!await homeMore.isVisible()) await page.getByRole('button', { name: 'Lists', exact: true }).click();
      await homeMore.click();
      await page.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
      await page.locator('.account-row').filter({ has: page.locator('strong', { hasText: /^Google Tasks$/ }) }).click();
    }
    async function closeAndAttemptBlockedCompletion() {
      await page.locator('.accounts-header').getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Synthetic Tasks', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Complete Synthetic completion gate', exact: true }).click();
      await expect(page.locator('[data-ui="notice"]')).toContainText('Review and import');
      await page.waitForTimeout(100);
      assert.equal(patches, 0, 'Refresh must not enable writes before an explicit Import confirmation');
      assert.equal((await savedTask()).completed, false);
    }
    await page.goto(base);
    await accounts();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Synthetic Tasks', exact: true }).check();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Import on This Device', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Allow me to complete selected, imported tasks in Google Tasks.', exact: true }).check();
    await page.getByRole('button', { name: 'Enable Google Tasks Completion', exact: true }).click();
    await expect(page.locator('.accounts-status')).toContainText('Review and import');
    await page.getByRole('button', { name: 'Refresh Imported Lists', exact: true }).click();
    await expect(page.locator('.accounts-status')).toContainText('Review and import');
    await closeAndAttemptBlockedCompletion();

    await accounts();
    await page.getByRole('button', { name: 'Import on This Device', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh Imported Lists', exact: true }).click();
    await expect(page.locator('.accounts-status')).toContainText('imported');
    await expect(page.getByRole('button', { name: 'Import on This Device', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh Imported Lists', exact: true }).click();
    await expect(page.locator('.accounts-status')).toContainText('Review and import');
    await closeAndAttemptBlockedCompletion();

    await accounts();
    await page.getByRole('button', { name: 'Import on This Device', exact: true }).click();
    await page.locator('.accounts-header').getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Synthetic Tasks', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Complete Synthetic completion gate', exact: true }).click();
    await expect.poll(() => patches).toBe(1);
    await expect.poll(async () => (await savedTask()).completed).toBe(true);
    assert.deepEqual(await page.evaluate(() => window.__testScopes), ['https://www.googleapis.com/auth/tasks.readonly', 'https://www.googleapis.com/auth/tasks']);
    assert.deepEqual(blocked, [], 'No private API or real external service may be contacted');
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('synthetic-regression-token')) || document.documentElement.textContent.includes('synthetic-regression-token')), false);
    return { status: 'PASS', cases: ['new grant + Refresh remains gated', 'approved unchanged refresh stays enabled', 'new preview + Refresh remains gated', 'explicit Import enables one confirmed completion'], realProviderRequests: 0 };
  } finally { await context.close(); await browser.close(); }
}

module.exports = { run };
if (require.main === module) run().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
