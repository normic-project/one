// Stop the isolated browser fixture explicitly so Playwright does not depend on
// platform-specific process-tree termination during audit verification.
module.exports = async function teardown() {
  const response = await fetch('http://127.0.0.1:8547/__shutdown', { method: 'POST' });
  if (!response.ok) throw new Error(`Browser fixture shutdown failed: HTTP ${response.status}`);
};
