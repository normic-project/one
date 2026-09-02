const { test, expect } = require('@playwright/test');

const DEFAULT_YES_OUTCOME = 'The market question resolves affirmatively according to the specified resolution source.';
const DEFAULT_NO_OUTCOME = 'The market question resolves negatively according to the specified resolution source.';
const DEFAULT_RULES = 'Resolve YES if the specified resolution source confirms the condition described in the market question. Resolve NO if the source confirms the condition did not occur. Resolve INVALID if the outcome cannot be objectively determined from the specified source.';

test.beforeEach(async ({ page, request }, testInfo) => {
  const fixture = await (await request.get('http://127.0.0.1:8547/fixture')).json();
  const account = testInfo.title.includes('confirmed zero financial states') ? fixture.emptyAccount
    : testInfo.title.includes('positive creator financial values') ? fixture.creatorAccount : fixture.account;
  const standardMobile = testInfo.title.includes('normal mobile browser');
  const moreWallets = testInfo.title.includes('More wallets opens');
  const rejectConnection = testInfo.title.includes('rejected wallet connection');
  const bitget = testInfo.title.includes('Bitget injected wallet');
  const metaMask = testInfo.title.includes('MetaMask injected wallet');
  await page.addInitScript(({ account, standardMobile, moreWallets, rejectConnection, bitget, metaMask }) => {
    const listeners = {};
    const testState = { disconnects: 0, switches: 0, addChainCalls: 0, remoteConnections: 0 };
    const walletIcon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%236e1f2a%22/%3E%3C/svg%3E';
    let activeChain = window.location.search.includes('wrong-network') || window.location.search.includes('missing-network') ? '0x1' : '0x1237';
    let chainAdded = !window.location.search.includes('missing-network');
    const provider = {
      on(event, listener) { listeners[event] = listener; },
      removeListener(event) { delete listeners[event]; },
      async request({ method, params }) {
        if (method === 'eth_requestAccounts') {
          if (rejectConnection) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return [account];
        }
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return activeChain;
        if (method === 'wallet_switchEthereumChain') {
          testState.switches += 1;
          if (!chainAdded) throw Object.assign(new Error('Unknown chain.'), { code: 4902 });
          activeChain = params[0].chainId;
          listeners.chainChanged?.(activeChain);
          return null;
        }
        if (method === 'wallet_addEthereumChain') { chainAdded = true; testState.addChainCalls += 1; return null; }
        const response = await fetch('http://127.0.0.1:8547', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
        const data = await response.json();
        if (data.error) throw Object.assign(new Error(data.error.message), data.error);
        return data.result;
      }
    };
    window.__walletTest = testState;
    if (standardMobile || moreWallets) {
      window.__ONE_SHOT_WALLETCONNECT_PROVIDER__ = {
        ...provider,
        session: { topic: 'test-walletconnect-session' },
        enable: async () => { testState.remoteConnections += 1; return [account]; },
        disconnect: async () => { testState.disconnects += 1; listeners.disconnect?.({ code: 4900 }); },
      };
    }
    if (!standardMobile) {
      window.ethereum = provider;
      if (bitget || metaMask) {
        window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { info: bitget
            ? { uuid: 'bitget-test', name: 'Bitget Wallet', icon: walletIcon, rdns: 'com.bitget.web3' }
            : { uuid: 'metamask-test', name: 'MetaMask', icon: walletIcon, rdns: 'io.metamask' }, provider },
        })));
      }
    }
  }, { account, standardMobile, moreWallets, rejectConnection, bitget, metaMask });
});

async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('button', { name: 'Browser wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('desktop injected wallet is shown first without a generic WalletConnect primary row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop injected-wallet coverage.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Browser wallet' })).toBeVisible();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More wallets' })).toBeVisible();
  await expect(page.getByText('Mobile wallet or QR code', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Browser wallet' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
});

test('More wallets opens the broader wallet picker connection path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Single-project broader picker coverage.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('button', { name: 'More wallets' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__walletTest.remoteConnections)).toBe(1);
});

test('mobile injected DApp browser connects through its EIP-1193 provider', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile DApp-browser coverage.');
  await page.goto('/');
  await connect(page);
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
});

test('normal mobile browser connects and restores a WalletConnect session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Ordinary mobile-browser coverage.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Browser wallet' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('one-shot:walletconnect-session'))).toBe('active');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__walletTest.disconnects)).toBe(1);
});

test('injected wallet disconnects and reconnects cleanly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Single-project reconnect coverage.');
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Disconnect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  await connect(page);
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
});

test('rejected wallet connection returns the selector to an interactive state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Single-project rejection coverage.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  const browserWallet = page.getByRole('button', { name: 'Browser wallet' });
  await browserWallet.click();
  await expect(page.getByRole('alert')).toHaveText('Connection request declined. Nothing was changed.');
  await expect(browserWallet).toBeEnabled();
});

test('Bitget injected wallet is discovered through the standard provider interface', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Bitget Wallet' }).locator('img')).toHaveAttribute('src', /^data:image\//);
  await page.getByRole('button', { name: 'Bitget Wallet' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
});

test('MetaMask injected wallet uses discovered name and icon metadata', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Single-project named-wallet coverage.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  const metaMask = page.getByRole('button', { name: 'MetaMask' });
  await expect(metaMask.locator('img')).toHaveAttribute('src', /^data:image\//);
  await metaMask.click();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
});

test('unknown network is added and switched through the existing wallet flow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Single-project network-add coverage.');
  await page.goto('/?missing-network=1');
  await connect(page);
  await page.getByRole('button', { name: 'Switch network' }).click();
  await expect(page.getByRole('button', { name: 'Switch network' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__walletTest.addChainCalls)).toBe(1);
  expect(await page.evaluate(() => window.__walletTest.switches)).toBe(2);
});

test('home derives general-purpose categories and safely renders immutable event rules', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png?v=2');
  await expect(page.locator('.logo-mark')).toHaveCount(2);
  expect(await page.locator('.logo-mark').evaluateAll(marks => marks.every(mark => mark.getAttribute('src') === '/one-shot-mark.png'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Buy $SHOT' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy $SHOT' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Buy $SHOT' })).toHaveCount(0);
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
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel & reclaim', exact: true }).last().click();
  await page.getByRole('button', { name: 'No', exact: false }).last().click();
  await page.getByRole('spinbutton', { name: 'Limit price', exact: true }).fill('47');
  await page.getByRole('spinbutton', { name: 'Number of shares', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Buy NO · limit order' }).click();
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel & reclaim', exact: true }).last().click();
  await page.getByRole('button', { name: 'Yes', exact: false }).last().click();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Number of shares', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Sell YES · limit order' }).click();
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
});

test('portfolio shows open orders, positions, INVALID value and redemption', async ({ page }) => {
  await page.goto('/portfolio');
  await connect(page);
  await expect(page.locator('.market-cell').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Resolved positions' }).click();
  await expect(page.getByText('INVALID · 0.5 USDG').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redeem 0.5' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Redeem 0.5' }).first().click();
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('confirmed zero financial states render as zero without exposing the creator fee rate', async ({ page }) => {
  await page.goto('/creator');
  await expect(page.locator('.claim-amount')).toHaveText('Connect wallet');
  await connect(page);
  await expect(page.locator('.claim-amount')).toHaveText('0.00USDG');
  await expect(page.locator('.creator-stats > div').filter({ hasText: 'Created markets' }).locator('strong')).toHaveText('0');
  await expect(page.locator('.creator-stats > div').filter({ hasText: 'Total market volume' }).locator('strong')).toHaveText('$0.00');
  await expect(page.getByText('Your fee rate', { exact: true })).toHaveCount(0);
  await expect(page.getByText('of matched notional', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Claim creator fees' })).toBeDisabled();
  await expect(page.locator('.creator-summary')).not.toContainText('—');

  await page.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.locator('.metric-grid .metric strong')).toHaveText(['0.00 USDG', '0.00 USDG', '0.00 USDG']);
  await expect(page.locator('.metric-grid')).not.toContainText('—');
});

test('positive creator financial values render from the wallet summary', async ({ page }) => {
  await page.goto('/creator');
  await connect(page);
  await expect(page.locator('.claim-amount')).toHaveText(/^[1-9][\d,.]*\.\d{2,6}USDG$/);
  await expect(page.getByRole('button', { name: 'Claim creator fees' })).toBeEnabled();
  await expect(page.locator('.creator-stats > div').filter({ hasText: 'Created markets' }).locator('strong')).not.toHaveText('0');
  await expect(page.locator('.creator-stats > div').filter({ hasText: 'Total market volume' }).locator('strong')).not.toHaveText('$0.00');
});

test('Refresh spins, blocks duplicate clicks, and settles after success', async ({ page }) => {
  await page.goto('/portfolio');
  await connect(page);
  const button = page.getByRole('button', { name: 'Refresh' });
  await expect(button).toBeEnabled();

  let releaseRefresh;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  let requestCount = 0;
  await page.route('**/api/wallet/**', async route => {
    requestCount += 1;
    await refreshGate;
    await route.continue();
  });
  await button.evaluate(element => { element.click(); element.click(); });
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeDisabled();
  await expect(button.locator('svg')).toHaveClass(/spin/);
  await expect(button.locator('svg')).toHaveCSS('animation-name', 'spin');
  await expect.poll(() => requestCount).toBe(3);
  releaseRefresh();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(button).toBeEnabled();
  await expect(button.locator('svg')).not.toHaveClass(/spin/);
  expect(requestCount).toBe(3);
});

test('Refresh stops spinning and restores its guard after failure', async ({ page }) => {
  await page.goto('/portfolio');
  await connect(page);
  const button = page.getByRole('button', { name: 'Refresh' });
  await page.route('**/api/wallet/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Refresh failed' }) });
  });
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button.locator('svg')).toHaveClass(/spin/);
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(button).toBeEnabled();
  await expect(button.locator('svg')).not.toHaveClass(/spin/);
  await expect(page.locator('.metric-grid .metric strong')).toHaveText(['Unavailable', 'Unavailable', 'Unavailable']);
  await expect(page.getByRole('alert').filter({ hasText: 'Refresh failed' })).toBeVisible();
});

test('wallet API failures remain unavailable instead of becoming financial zeroes', async ({ page }) => {
  await page.route('**/api/wallet/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Indexed wallet data unavailable' }) });
  });
  await page.goto('/portfolio');
  await connect(page);
  await expect(page.locator('.metric-grid .metric strong').first()).toHaveText('Loading…');
  await expect(page.locator('.metric-grid .metric strong')).toHaveText(['Unavailable', 'Unavailable', 'Unavailable']);
  await expect(page.getByRole('alert').filter({ hasText: 'Indexed wallet data unavailable' })).toBeVisible();
  await expect(page.locator('.metric-grid')).not.toContainText('0.00 USDG');
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
  await expect(page.getByRole('button', { name: 'Connect wallet to create' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('YES meaning')).not.toBeVisible();
  await page.getByText('Advanced resolution settings', { exact: true }).click();
  await expect(page.getByLabel('YES meaning')).toHaveValue(DEFAULT_YES_OUTCOME);
  await expect(page.getByLabel('NO meaning')).toHaveValue(DEFAULT_NO_OUTCOME);
  await expect(page.getByLabel('Resolution rules')).toHaveValue(DEFAULT_RULES);
  await expect(page.getByLabel('Secondary source · optional')).toHaveValue('');
  await expect(page.getByLabel('Metadata URI · optional')).toHaveValue('');
  await page.getByText('Advanced resolution settings', { exact: true }).click();
  await connect(page);
  await page.getByLabel('Question').fill('Will Example Company publicly launch Product X before December 31?');
  await page.getByLabel('Resolution source').fill('https://example.com/official-newsroom');
  const resolutionDate = page.getByLabel('Resolution date');
  const validResolutionDate = await resolutionDate.inputValue();
  await resolutionDate.fill('2020-01-01T00:00');
  await expect(page.getByText('Trading must close at least one minute from now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create market' })).toBeDisabled();
  await resolutionDate.fill(validResolutionDate);
  await expect(page.getByRole('button', { name: 'Create market' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create market' }).click();
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/market\/0x/, { timeout: 30000 });
  await expect(page.getByText(DEFAULT_YES_OUTCOME, { exact: true })).toBeVisible();
  await expect(page.getByText(DEFAULT_NO_OUTCOME, { exact: true })).toBeVisible();
  await expect(page.getByText(DEFAULT_RULES, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('creates an arbitrary Event market and warns about ambiguous rules', async ({ page }) => {
  await page.goto('/create');
  await connect(page);
  await page.getByLabel('Question').fill('Will it launch soon?');
  await expect(page.getByText('may be ambiguous')).toBeVisible();
  await page.getByLabel('Question').fill('Will Example Company publicly launch Product X before December 31?');
  await page.getByLabel('Resolution source').fill('https://example.com/official-newsroom');
  await page.getByRole('button', { name: 'Create market' }).click();
  await expect(page.getByText('Confirmed.')).toBeVisible({ timeout: 30000 });
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
