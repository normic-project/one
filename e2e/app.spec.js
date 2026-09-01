const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page, request }) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  await page.addInitScript(({ account }) => {
    const listeners = {};
    window.ethereum = {
      on(event, listener) { listeners[event] = listener; },
      removeListener(event) { delete listeners[event]; },
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId' && window.location.search.includes('wrong-network')) return '0x1';
        if (method === 'wallet_switchEthereumChain') return null;
        const response = await fetch('http://127.0.0.1:8547', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
        const data = await response.json();
        if (data.error) throw Object.assign(new Error(data.error.message), data.error);
        return data.result;
      }
    };
  }, fixture);
});

async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('button', { name: 'Browser wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('home derives general-purpose categories and safely renders immutable event rules', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /A market for/ })).toBeVisible();
  await expect(page.locator('.market-card').first()).toBeVisible();
  await expect(page.getByLabel('Market category')).toContainText('Politics');
  await page.getByLabel('Market category').selectOption('Tech');
  await page.getByRole('textbox', { name: 'Search markets' }).fill('Delta');
  await page.locator('.market-card').first().click();
  await expect(page.getByRole('heading', { name: 'Resolution rules', exact: true })).toBeVisible();
  await expect(page.getByText('EVENT_MARKET', { exact: true })).toBeVisible();
  await expect(page.getByText('No matching demand at this price.', { exact: false })).toBeVisible();
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  await page.goto(`/market/${fixture.unsafeSource}`);
  await expect(page.getByText('javascript:alert(document.domain)', { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('buys YES and NO, sells a position, and cancels unmatched orders', async ({ page, request }) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  await page.goto(`/market/${fixture.market}`);
  await connect(page);
  await page.getByRole('spinbutton', { name: 'Limit price', exact: true }).fill('53');
  await page.getByRole('spinbutton', { name: 'Number of shares', exact: true }).fill('7');
  await page.getByRole('button', { name: 'Buy YES · limit order' }).click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel & reclaim', exact: true }).last().click();
  await page.getByRole('button', { name: 'No', exact: false }).last().click();
  await page.getByRole('spinbutton', { name: 'Limit price', exact: true }).fill('47');
  await page.getByRole('spinbutton', { name: 'Number of shares', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Buy NO · limit order' }).click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel & reclaim', exact: true }).last().click();
  await page.getByRole('button', { name: 'Yes', exact: false }).last().click();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Number of shares', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Sell YES · limit order' }).click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
});

test('portfolio shows open orders, positions, INVALID value and redemption', async ({ page }) => {
  await page.goto('/portfolio');
  await connect(page);
  await expect(page.locator('.market-cell').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Resolved positions' }).click();
  await expect(page.getByText('INVALID · 0.5 USDG').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redeem 0.5' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Redeem 0.5' }).first().click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('market pages render pending, YES, NO and INVALID event states', async ({ page, request }) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  const cases = [
    [fixture.pending, 'EVENT_MARKET', 'Closed'],
    [fixture.resolvedYes, 'EVENT_MARKET', 'Resolved YES'],
    [fixture.resolvedNo, 'EVENT_MARKET', 'Resolved NO'],
    [fixture.invalid, 'EVENT_MARKET', 'Resolved INVALID']
  ];
  for (const [address, type, state] of cases) {
    await page.goto(`/market/${address}`);
    await expect(page.getByText(type, { exact: true })).toBeVisible();
    await expect(page.getByText(state, { exact: true }).last()).toBeVisible();
  }
});

test('shows resolver-only finalization and no deleted resolution controls', async ({ page, request }) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  await page.goto(`/market/${fixture.pending}`);
  await expect(page.getByRole('heading', { name: 'Final resolution' })).toBeVisible();
  await expect(page.getByText('Only the configured Resolver Safe')).toBeVisible();
  await expect(page.getByText('Redemption remains disabled')).toBeVisible();
  await expect(page.getByLabel('Proposal evidence')).toHaveCount(0);
  await expect(page.getByLabel('Dispute evidence')).toHaveCount(0);
  await expect(page.getByText(/TWAP/)).toHaveCount(0);
});

test('creates a general event market through a real local contract transaction', async ({ page }) => {
  await page.goto('/create');
  await connect(page);
  await page.getByLabel('Event question').fill('Will Example Company publicly launch Product X before December 31?');
  await page.getByLabel('YES means').fill('Product X is publicly available before the cutoff.');
  await page.getByLabel('NO means').fill('Product X is not publicly available before the cutoff.');
  await page.getByLabel('Resolution rules').fill('Resolve YES only if the official newsroom announces general availability before the exact cutoff. Resolve NO otherwise and INVALID only if the immutable rules cannot be applied.');
  await page.getByLabel('Primary resolution source').fill('https://example.com/official-newsroom');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create market · 0.0006 ETH' }).click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('creates an arbitrary Event market and warns about ambiguous rules', async ({ page }) => {
  await page.goto('/create');
  await connect(page);
  await page.getByLabel('Event question').fill('Will it launch soon?');
  await expect(page.getByText('may be ambiguous')).toBeVisible();
  await page.getByLabel('Event question').fill('Will Example Company publicly launch Product X before December 31?');
  await page.getByLabel('YES means').fill('Product X is publicly available before the cutoff.');
  await page.getByLabel('NO means').fill('Product X is not publicly available before the cutoff.');
  await page.getByLabel('Resolution rules').fill('Resolve YES only if the official newsroom announces general availability before the exact cutoff. Resolve NO otherwise and INVALID only if the immutable rules cannot be applied.');
  await page.getByLabel('Primary resolution source').fill('https://example.com/official-newsroom');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create market · 0.0006 ETH' }).click();
  await expect(page.getByText('Confirmed on Robinhood Chain.')).toBeVisible({ timeout: 30000 });
  await page.goto('/creator');
  await expect(page.getByRole('heading', { name: 'Creator studio' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('blocks transactions when the wallet is connected to another chain', async ({ page, request }) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  await page.goto(`/market/${fixture.market}?wrong-network=1`);
  await connect(page);
  await expect(page.getByRole('button', { name: 'Switch network' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy YES · limit order' })).toBeDisabled();
});
