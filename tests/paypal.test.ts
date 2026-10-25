import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- Node 24 native TypeScript tests.
import { createPayPalClient, PayPalError, PAYPAL_SANDBOX_ORIGIN, verifyOrder, formatAmount, paymentRequestId, sandboxApprovalUrl } from "../lib/paypal.ts";

const config = { clientId: "sandbox-client", clientSecret: "never-log-this", merchantId: "MERCHANT123" };
const baseOrder = () => ({ id: "ORDER123", status: "CREATED", intent: "AUTHORIZE", purchase_units: [{ reference_id: "pledge1", invoice_id: "pledge1", custom_id: "batch1@1", payee: { merchant_id: "MERCHANT123" }, amount: { currency_code: "USD", value: "12.30" } }] });
const expected = { pledgeId: "pledge1", batchId: "batch1", revision: 1, amountMinor: 1230, currency: "USD" as const, merchantId: "MERCHANT123" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("MOCK: sandbox origin, AUTHORIZE, immutable exact amount and stable request ID", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return String(url).endsWith("/token") ? json({ access_token: "test-access-token", expires_in: 3600 }) : json(baseOrder(), 201);
  };
  const client = createPayPalClient({ ...config, fetch: fetcher });
  const requestId = await paymentRequestId("pledge1", "create");
  const input = { ...expected, description: "One made-to-order mug", returnUrl: "https://batchloom.example/return", cancelUrl: "https://batchloom.example/cancel", requestId };
  await client.createOrder(input); await client.createOrder(input);
  assert.equal(calls.length, 3, "OAuth token is reused");
  assert.ok(calls.every((call) => new URL(call.url).origin === PAYPAL_SANDBOX_ORIGIN));
  const body = JSON.parse(calls[1].init.body as string);
  assert.equal(body.intent, "AUTHORIZE");
  assert.equal(body.purchase_units.length, 1);
  assert.equal(body.purchase_units[0].amount.value, "12.30");
  assert.equal(body.purchase_units[0].payee.merchant_id, "MERCHANT123");
  assert.equal(body.payment_source.paypal.experience_context.shipping_preference, "GET_FROM_FILE");
  assert.equal(new Headers(calls[1].init.headers).get("PayPal-Request-Id"), requestId);
  assert.equal(new Headers(calls[2].init.headers).get("PayPal-Request-Id"), requestId);
  assert.ok(calls.every(call => call.init.redirect === "manual"));
  assert.ok(calls.every(call => call.init.cache === "no-store"));
});

test("MOCK: edge-compatible manual redirects never forward OAuth or bearer credentials", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const redirectOAuth of [true, false]) {
      const calls: string[] = [];
      const client = createPayPalClient({ ...config, fetch: async (url, init) => {
        const target = String(url); calls.push(target);
        assert.equal(init?.redirect, "manual"); assert.equal(init?.cache, "no-store");
        assert.equal(new URL(target).origin, PAYPAL_SANDBOX_ORIGIN);
        if (!redirectOAuth && target.endsWith("/token")) return json({ access_token: "private-token", expires_in: 300 });
        return new Response(null, { status, headers: { Location: "https://untrusted.example/collect" } });
      } });
      await assert.rejects(client.authorizeOrder("ORDER1", "authorize1"), (error: unknown) => {
        assert.ok(error instanceof PayPalError); assert.equal(error.code, "REDIRECT_BLOCKED"); assert.equal(error.uncertain, !redirectOAuth);
        assert.doesNotMatch(String(error), /never-log-this|private-token|untrusted/); return true;
      });
      assert.equal(calls.length, redirectOAuth ? 1 : 2);
    }
  }
});

test("MOCK: mutation timeout is uncertain and never leaks credentials", async () => {
  const fetcher: typeof fetch = async (url) => String(url).endsWith("/token") ? json({ access_token: "secret-token", expires_in: 3600 }) : new Promise(() => {});
  const client = createPayPalClient({ ...config, fetch: fetcher, timeoutMs: 10 });
  await assert.rejects(client.captureAuthorization("AUTH1", { amountMinor: 1230, currency: "USD", invoiceId: "pledge1", requestId: "capture1" }), (error: unknown) => {
    assert.ok(error instanceof PayPalError);
    assert.equal(error.uncertain, true);
    assert.equal(error.code, "TIMEOUT");
    assert.doesNotMatch(String(error), /never-log-this|secret-token/);
    return true;
  });
});

test("MOCK: 5xx mutation is uncertain; definite 422 is distinct; malformed success is uncertain", async () => {
  for (const [response, uncertain] of [[json({ secret: "must-not-leak" }, 503), true], [json({}, 422), false], [json(null, 201), true]] as const) {
    const fetcher: typeof fetch = async (url) => String(url).endsWith("/token") ? json({ access_token: "token", expires_in: 300 }) : response;
    const client = createPayPalClient({ ...config, fetch: fetcher });
    await assert.rejects(client.authorizeOrder("ORDER1", "authorize1"), (error: unknown) => {
      assert.ok(error instanceof PayPalError); assert.equal(error.uncertain, uncertain); assert.doesNotMatch(String(error), /must-not-leak/); return true;
    });
  }
});

test("MOCK: all immutable order fields are checked, not only the total", () => {
  assert.equal(verifyOrder(baseOrder(), expected).reference_id, "pledge1");
  const mutations = [
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].amount.value = "0.01"; },
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].amount.currency_code = "EUR"; },
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].payee.merchant_id = "ATTACKER"; },
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].reference_id = "other"; },
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].invoice_id = "other"; },
    (o: ReturnType<typeof baseOrder>) => { o.purchase_units[0].custom_id = "batch1@2"; },
  ];
  for (const mutate of mutations) { const order = baseOrder(); mutate(order); assert.throws(() => verifyOrder(order, expected), /does not match/); }
  const wrongIntent = baseOrder(); wrongIntent.intent = "CAPTURE";
  assert.throws(() => verifyOrder(wrongIntent, expected), /unexpected intent/);
});

test("MOCK: webhook signature failures are rejected and foreign certificate URLs are not fetched", async () => {
  let calls = 0;
  const client = createPayPalClient({ ...config, fetch: async (url) => { calls++; return String(url).endsWith("/token") ? json({ access_token: "token", expires_in: 300 }) : json({ verification_status: "FAILURE" }); } });
  const headers = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://attacker.example/cert", "paypal-transmission-id": "tx1", "paypal-transmission-sig": "sig", "paypal-transmission-time": new Date().toISOString() });
  assert.equal(await client.verifyWebhook({ webhookId: "WH1", headers, event: {} }), false);
  assert.equal(calls, 0);
  headers.set("paypal-cert-url", "not-a-url");
  assert.equal(await client.verifyWebhook({ webhookId: "WH1", headers, event: {} }), false);
  headers.set("paypal-cert-url", "https://api.sandbox.paypal.com/v1/notifications/certs/CERT1");
  assert.equal(await client.verifyWebhook({ webhookId: "WH1", headers, event: {} }), false);
  assert.equal(calls, 2);
});

test("money and identifiers cannot inject paths or change the sandbox target", async () => {
  assert.equal(formatAmount(101), "1.01");
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => formatAmount(value));
  assert.equal(await paymentRequestId("p1", "capture"), await paymentRequestId("p1", "capture"));
  assert.notEqual(await paymentRequestId("p1", "capture"), await paymentRequestId("p1", "full-refund"));
  assert.equal(sandboxApprovalUrl({ id: "O", status: "CREATED", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=O" }] }), "https://www.sandbox.paypal.com/checkoutnow?token=O");
  assert.throws(() => sandboxApprovalUrl({ id: "O", status: "CREATED", links: [{ rel: "approve", href: "https://www.paypal.com/checkoutnow?token=O" }] }));
  const client = createPayPalClient({ ...config, fetch: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(client.getOrder("../../live"), /Invalid/);
});
