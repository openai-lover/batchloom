/** Sandbox-only PayPal transport. This module must only be imported by server code. */
export const PAYPAL_SANDBOX_ORIGIN = "https://api-m.sandbox.paypal.com";

export type Currency = "USD";
export interface Money { currency_code: string; value: string }
export interface PayPalLink { href: string; rel: string; method?: string }
export interface PayPalCapture {
  id: string; status: string; amount?: Money; final_capture?: boolean;
  supplementary_data?: { related_ids?: { authorization_id?: string; order_id?: string } };
  links?: PayPalLink[];
}
export interface PayPalAuthorization {
  id: string; status: string; amount?: Money; create_time?: string; expiration_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } }; links?: PayPalLink[];
}
export interface PayPalRefund { id: string; status: string; amount?: Money; links?: PayPalLink[] }
export interface PayPalPurchaseUnit {
  reference_id?: string; custom_id?: string; invoice_id?: string; amount?: Money;
  payee?: { merchant_id?: string };
  payments?: { authorizations?: PayPalAuthorization[]; captures?: PayPalCapture[]; refunds?: PayPalRefund[] };
}
export interface PayPalOrder { id: string; status: string; intent?: string; purchase_units?: PayPalPurchaseUnit[]; links?: PayPalLink[] }
export interface ExpectedOrder {
  pledgeId: string; batchId: string; revision: number; amountMinor: number;
  currency: Currency; merchantId: string;
}
export interface CreateOrderInput extends Omit<ExpectedOrder, "merchantId"> {
  description: string; returnUrl: string; cancelUrl: string; requestId: string;
  shippingPreference?: "GET_FROM_FILE" | "NO_SHIPPING";
}
export interface CaptureInput { amountMinor: number; currency: Currency; invoiceId: string; requestId: string }
export interface PayPalPort {
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  getAuthorization(id: string): Promise<PayPalAuthorization>;
  getCapture(id: string): Promise<PayPalCapture>;
  getRefund(id: string): Promise<PayPalRefund>;
  captureAuthorization(id: string, input: CaptureInput): Promise<PayPalCapture>;
  voidAuthorization(id: string): Promise<void>;
  refundCapture(id: string, requestId: string): Promise<PayPalRefund>;
  verifyWebhook(input: { webhookId: string; headers: Headers; event: unknown }): Promise<boolean>;
}

export class PayPalError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly uncertain: boolean;
  constructor(code: string, options: { status?: number; uncertain?: boolean } = {}) {
    super(`PayPal sandbox request could not be confirmed (${code}).`);
    this.name = "PayPalError";
    this.code = code;
    this.status = options.status;
    this.uncertain = options.uncertain ?? false;
  }
}

function identifier(value: string, name = "identifier"): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error(`Invalid ${name}.`);
  return value;
}
export function formatAmount(amountMinor: number, currency: Currency = "USD"): string {
  if (currency !== "USD" || !Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100_000_000) {
    throw new Error("Expected a positive USD amount in integer cents within the demo limit.");
  }
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}
export function moneyMatches(money: Money | undefined, amountMinor: number, currency: Currency): boolean {
  return money?.currency_code === currency && money?.value === formatAmount(amountMinor, currency);
}
export function orderCorrelation(batchId: string, revision: number): string {
  identifier(batchId, "batch ID");
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid batch revision.");
  return `${batchId}@${revision}`;
}
export function verifyOrder(order: PayPalOrder, expected: ExpectedOrder): PayPalPurchaseUnit {
  if (!order.id || order.intent !== "AUTHORIZE" || order.purchase_units?.length !== 1) throw new Error("PayPal order has an unexpected intent or purchase unit count.");
  const unit = order.purchase_units[0];
  if (unit.reference_id !== expected.pledgeId || unit.invoice_id !== expected.pledgeId ||
      unit.custom_id !== orderCorrelation(expected.batchId, expected.revision) ||
      unit.payee?.merchant_id !== expected.merchantId || !moneyMatches(unit.amount, expected.amountMinor, expected.currency)) {
    throw new Error("PayPal order does not match the approved pledge.");
  }
  return unit;
}
export function sandboxApprovalUrl(order: PayPalOrder): string | null {
  const link = order.links?.find((item) => item.rel === "payer-action" || item.rel === "approve");
  if (!link) return null;
  const url = new URL(link.href);
  if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com" || url.port || url.username || url.password) {
    throw new Error("PayPal returned a non-sandbox approval URL.");
  }
  return url.href;
}
export async function paymentRequestId(pledgeId: string, operation: string): Promise<string> {
  const bytes = new TextEncoder().encode(`batchloom:v1:${pledgeId}:${operation}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `bl-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}
function returnUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Invalid checkout return URL.");
  }
  return url.href;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response object.");
  return value as Record<string, unknown>;
}
function resource<T extends { id: string; status: string }>(value: unknown, mutation: boolean): T {
  let data: Record<string, unknown>;
  try { data = object(value); } catch { throw new PayPalError("INVALID_RESPONSE", { uncertain: mutation }); }
  if (typeof data.id !== "string" || typeof data.status !== "string") {
    throw new PayPalError("INVALID_RESPONSE", { uncertain: mutation });
  }
  return data as unknown as T;
}

export function createPayPalClient(config: {
  clientId: string; clientSecret: string; merchantId: string;
  fetch?: typeof fetch; timeoutMs?: number; now?: () => number;
}): PayPalPort {
  if (!config.clientId || !config.clientSecret || !config.merchantId) throw new Error("PayPal sandbox credentials are not configured.");
  const fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid PayPal timeout.");
  let token: { value: string; expiresAt: number } | undefined;
  let tokenPromise: Promise<string> | undefined;

  async function transport(path: string, init: RequestInit, mutation: boolean): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new PayPalError("TIMEOUT", { uncertain: mutation })); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        // Workers supports manual/follow, but not redirect:"error". Never follow
        // a redirect with credentials, and bypass framework caches for provider truth.
        const response = await fetcher(`${PAYPAL_SANDBOX_ORIGIN}${path}`, { ...init, signal: controller.signal, redirect: "manual", cache: "no-store" });
        if (response.status >= 300 && response.status < 400) throw new PayPalError("REDIRECT_BLOCKED", { status: response.status, uncertain: mutation });
        if (!response.ok) {
          // Provider bodies can contain personal data; never propagate or log them.
          throw new PayPalError(`HTTP_${response.status}`, { status: response.status, uncertain: mutation && (response.status >= 500 || response.status === 408) });
        }
        if (response.status === 204) return undefined;
        try { return await response.json(); }
        catch { throw new PayPalError("INVALID_RESPONSE", { uncertain: mutation }); }
      })()]);
    } catch (error) {
      if (error instanceof PayPalError) throw error;
      throw new PayPalError("NETWORK_ERROR", { uncertain: mutation });
    } finally { if (timer) clearTimeout(timer); }
  }
  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now() + 30_000) return token.value;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const raw = object(await transport("/v1/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      }, false));
      if (typeof raw.access_token !== "string" || typeof raw.expires_in !== "number" || raw.expires_in <= 0) throw new PayPalError("INVALID_TOKEN_RESPONSE");
      token = { value: raw.access_token, expiresAt: now() + raw.expires_in * 1000 };
      return token.value;
    })();
    try { return await tokenPromise; } finally { tokenPromise = undefined; }
  }
  async function api(path: string, method = "GET", body?: unknown, requestId?: string): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Prefer: "return=representation" };
    if (requestId) headers["PayPal-Request-Id"] = identifier(requestId, "request ID");
    try { return await transport(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, method !== "GET"); }
    catch (error) { if (error instanceof PayPalError && error.status === 401) token = undefined; throw error; }
  }
  return {
    async createOrder(input) {
      const pledgeId = identifier(input.pledgeId, "pledge ID");
      const data = await api("/v2/checkout/orders", "POST", {
        intent: "AUTHORIZE",
        purchase_units: [{
          reference_id: pledgeId, invoice_id: pledgeId, custom_id: orderCorrelation(input.batchId, input.revision),
          description: input.description.slice(0, 127), payee: { merchant_id: config.merchantId },
          amount: { currency_code: input.currency, value: formatAmount(input.amountMinor, input.currency) },
        }],
        payment_source: { paypal: { experience_context: {
          brand_name: "Batchloom", user_action: "PAY_NOW", shipping_preference: input.shippingPreference ?? "GET_FROM_FILE",
          return_url: returnUrl(input.returnUrl), cancel_url: returnUrl(input.cancelUrl),
        } } },
      }, input.requestId);
      return resource<PayPalOrder>(data, true);
    },
    async authorizeOrder(id, requestId) { return resource<PayPalOrder>(await api(`/v2/checkout/orders/${identifier(id)}/authorize`, "POST", {}, requestId), true); },
    async getOrder(id) { return resource<PayPalOrder>(await api(`/v2/checkout/orders/${identifier(id)}`), false); },
    async getAuthorization(id) { return resource<PayPalAuthorization>(await api(`/v2/payments/authorizations/${identifier(id)}`), false); },
    async getCapture(id) { return resource<PayPalCapture>(await api(`/v2/payments/captures/${identifier(id)}`), false); },
    async getRefund(id) { return resource<PayPalRefund>(await api(`/v2/payments/refunds/${identifier(id)}`), false); },
    async captureAuthorization(id, input) { return resource<PayPalCapture>(await api(`/v2/payments/authorizations/${identifier(id)}/capture`, "POST", {
      amount: { currency_code: input.currency, value: formatAmount(input.amountMinor, input.currency) },
      invoice_id: identifier(input.invoiceId), final_capture: true,
    }, input.requestId), true); },
    async voidAuthorization(id) { await api(`/v2/payments/authorizations/${identifier(id)}/void`, "POST", {}); },
    async refundCapture(id, requestId) { return resource<PayPalRefund>(await api(`/v2/payments/captures/${identifier(id)}/refund`, "POST", {}, requestId), true); },
    async verifyWebhook({ webhookId, headers, event }) {
      const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
      if (!webhookId || required.some((header) => !headers.get(header))) return false;
      // The URL is passed only to PayPal verification, never fetched by our application.
      let certUrl: URL;
      try { certUrl = new URL(headers.get("paypal-cert-url")!); } catch { return false; }
      if (certUrl.protocol !== "https:" || !["api.paypal.com", "api.sandbox.paypal.com", "api-m.paypal.com", "api-m.sandbox.paypal.com"].includes(certUrl.hostname) || certUrl.username || certUrl.password || certUrl.port) return false;
      const verification = object(await api("/v1/notifications/verify-webhook-signature", "POST", {
        auth_algo: headers.get("paypal-auth-algo"), cert_url: certUrl.href,
        transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"), webhook_id: webhookId, webhook_event: event,
      }));
      return verification.verification_status === "SUCCESS";
    },
  };
}
