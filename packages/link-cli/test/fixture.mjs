import { createServer } from 'node:http';
import { once } from 'node:events';

// Unknown routes fail closed. This server never forwards a request to Link.
export async function fixture(port = 0) {
  const calls = [];
  const state = { auth: 'pending', spend: 'pending_approval', denied: false };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const path = new URL(req.url, 'http://fixture').pathname;
    calls.push({ method: req.method, path, body });
    const respond = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (path === '/device/code' && req.method === 'POST') return respond({ device_code: 'fixture-device', user_code: 'quiet river', verification_uri: 'https://example.test/connect', verification_uri_complete: 'https://example.test/connect/fixture', expires_in: 600, interval: 0 });
    if (path === '/device/token' && req.method === 'POST') {
      if (state.auth === 'pending') return respond({ error: 'authorization_pending' }, 400);
      if (state.auth !== 'approved') return respond({ error: state.auth }, 400);
      return respond({ access_token: 'fixture-access-token-that-is-not-a-secret', refresh_token: 'fixture-refresh-token-that-is-not-a-secret', token_type: 'Bearer', expires_in: 3600, scope: 'userinfo:read payment_methods.agentic', authorization_details: [{ type: 'financial_sources', actions: ['read_link_transactions', 'read_external_transactions', 'read_balances', 'read_source_details'] }] });
    }
    if (state.denied) return respond({ error: { code: 'insufficient_scope', message: 'Fixture grant missing' } }, 403);
    if (path === '/balances' && req.method === 'GET') return respond({ data: [{ source_id: 'source_fixture', type: 'cash', current: 12345, currency: 'usd', as_of: '2026-01-01T00:00:00Z' }], has_more: false });
    if (path === '/spend_requests' && req.method === 'POST' || path === '/spend_requests/sr_fixture' && req.method === 'GET') {
      return respond({ id: 'sr_fixture', status: state.spend, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', approval_url: 'https://example.test/approve', ...(state.spend === 'approved' ? { card: { number: '4242424242424242', cvc: '123', exp_month: 12, exp_year: 2030 } } : {}) });
    }
    respond({ error: { code: 'fixture_route_denied', message: req.method + ' ' + path } }, 400);
  });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return { calls, state, url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
