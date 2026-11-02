import { createHmac, timingSafeEqual } from 'node:crypto';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { GIFT_CATALOGUE } from '../../../../panel/src/gifts/catalogue';
import { approvedPublicName } from '../../realm-auth/presentation';
import type { PanelViewer } from '../../public/panel/token';
import { extensionKey } from '../../public/panel/token';

export type PanelGiftRoute = 'gifts' | 'gift-intent' | 'gift-receipt' | 'gift-status' | 'gift-cancel' | 'gift-resolve' | 'gift-choices';
export interface GiftApiReply { readonly http: number; readonly body: unknown; readonly contentType?: 'text/plain' }
export interface PanelGiftApiOptions {
  readonly extensionId: string;
  readonly extensionSecret: string;
  readonly extensionClientSecret?: string;
  readonly webhookSecret?: string;
  readonly realm: (path: string, body: unknown) => Promise<Record<string, unknown>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Checkout retirement never removes already-paid evidence or issued intent recovery. */
  readonly retiredSkus?: ReadonlySet<string>;
}
const token = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const id = z.string().regex(/^[1-9][0-9]{0,31}$/);
const sku = z.string().regex(/^[a-z0-9]{1,100}$/);
const intentBody = z.strictObject({ requestId: z.uuid(), sku, targetPlotId: token.nullable() });
const receiptBody = z.strictObject({ intentId: token, receipt: z.string().min(1).max(24 * 1024) });
const statusBody = z.strictObject({ intentId: token });
const receiptAmount = z.union([z.number(), z.string().regex(/^[0-9]+$/).max(8)]).transform(Number).pipe(z.int().min(1).max(10_000));
const resolveBody = z.strictObject({ paymentRef: z.uuid(), intentId: z.uuid() });
const choicesBody = z.strictObject({ paymentRef: z.uuid(), cursor: z.string().min(1).max(256).optional() });
const knownSkus = new Set(GIFT_CATALOGUE.flatMap(gift => gift.bands.map(band => band.id)));
const product = z.object({ sku, domain: z.string(), cost: z.object({ amount: z.int().min(1).max(10_000), type: z.literal('bits') }), inDevelopment: z.boolean() });
const transaction = z.object({ id: token, timestamp: z.string(), broadcaster_id: id, user_id: id, user_name: z.string().min(1).max(64),
  product_type: z.literal('BITS_IN_EXTENSION'), product_data: product });
type Transaction = z.infer<typeof transaction>;
interface Receipt { transactionId: string; personId: string; sku: string; bits: number; inDevelopment: boolean; occurredAt: number }
const reply = (http: number, status: string, message?: string): GiftApiReply => ({ http, body: { version: 1, status, ...(message ? { message } : {}) } });
const unavailable = () => reply(503, 'unavailable', 'The kingdom cannot confirm gifts just now.');
const refused = () => reply(400, 'refused', 'This gift could not be confirmed.');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const utc = (value: string): number => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) throw new Error('Invalid provider time');
  const time = Date.parse(value); if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid provider time'); return time;
};

/** No receipt, Helper callback or viewer token alone establishes a paid transaction's channel. */
export function createPanelGifts(options: PanelGiftApiOptions) {
  const send = options.fetch ?? fetch, now = options.now ?? Date.now;
  const domain = `twitch.ext.${options.extensionId}`;
  let key: Uint8Array | undefined;
  try { key = extensionKey(options.extensionSecret); } catch { /* Missing setup leaves the shelf closed. */ }
  const needs = () => [!options.extensionId && 'TWITCH_EXTENSION_CLIENT_ID', !key && 'TWITCH_EXTENSION_SECRET',
    !options.extensionClientSecret && 'TWITCH_EXTENSION_CLIENT_SECRET'].filter((value): value is string => !!value);
  let access: { token: string; until: number; validatedAt: number } | undefined;
  let obtaining: Promise<string> | undefined;
  const boundedJson = async (response: Response, limit = 1024 * 1024): Promise<unknown> => {
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Provider unavailable');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new Error('Provider response too large'); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  };
  const appToken = async (): Promise<string> => {
    if (needs().length) throw new Error('Extension credentials unavailable');
    if (access && access.until > now() + 30_000 && now() - access.validatedAt < 3_600_000) return access.token;
    if (obtaining) return obtaining;
    obtaining = (async () => {
      if (!access || access.until <= now() + 30_000) {
        const body = await boundedJson(await send('https://id.twitch.tv/oauth2/token', { method: 'POST', redirect: 'error',
          body: new URLSearchParams({ client_id: options.extensionId, client_secret: options.extensionClientSecret!, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(5_000) }), 16_384);
        const parsed = z.object({ access_token: z.string().min(1).max(4096), expires_in: z.int().positive(), token_type: z.literal('bearer') }).parse(body);
        access = { token: parsed.access_token, until: now() + parsed.expires_in * 1000, validatedAt: 0 };
      }
      const checked = await boundedJson(await send('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access.token}` },
        redirect: 'error', signal: AbortSignal.timeout(5_000) }), 16_384);
      if (!isRecord(checked) || checked.client_id !== options.extensionId || typeof checked.expires_in !== 'number' || checked.expires_in <= 0) { access = undefined; throw new Error('Extension token not valid'); }
      access.validatedAt = now(); return access.token;
    })().catch(error => { access = undefined; throw error; }).finally(() => { obtaining = undefined; });
    return obtaining;
  };
  const history = async (after?: string, transactionId?: string) => {
    const authorization = await appToken();
    const url = new URL('https://api.twitch.tv/helix/extensions/transactions');
    url.searchParams.set('extension_id', options.extensionId); url.searchParams.set('first', '100');
    if (after) url.searchParams.set('after', after);
    if (transactionId) url.searchParams.set('id', transactionId);
    const read = (bearer: string) => send(url, { headers: { Authorization: `Bearer ${bearer}`, 'Client-Id': options.extensionId }, redirect: 'error', signal: AbortSignal.timeout(5_000) });
    let response = await read(authorization);
    if (response.status === 401) { access = undefined; response = await read(await appToken()); }
    const body = await boundedJson(response);
    const parsed = z.object({ data: z.array(transaction).max(100), pagination: z.object({ cursor: z.string().min(1).max(2048).optional() }).optional() }).parse(body);
    for (const row of parsed.data) {
      if (row.product_data.domain !== domain || utc(row.timestamp) > now() + 5_000) throw new Error('Wrong extension transaction');
    }
    return parsed;
  };
  const canonical = async (transactionId: string): Promise<Transaction> => {
    const page = await history(undefined, transactionId);
    if (page.data.length !== 1 || page.data[0]!.id !== transactionId) throw new Error('Transaction has not been confirmed');
    return page.data[0]!;
  };
  const record = async (row: Transaction, intentId?: string) => {
    const name = approvedPublicName(row.user_name); if (!name) throw new Error('Provider name unavailable');
    return options.realm('/internal/realm/panel/gift-evidence', { extensionId: options.extensionId, transactionId: row.id,
      kingdomId: row.broadcaster_id, personId: row.user_id, sku: row.product_data.sku, bits: row.product_data.cost.amount,
      inDevelopment: row.product_data.inDevelopment, occurredAt: utc(row.timestamp), name, ...(intentId ? { intentId } : {}) });
  };
  const readReceipt = async (raw: string): Promise<Receipt> => {
    if (!key) throw new Error('Receipt verification unavailable');
    const { payload } = await jwtVerify(raw, key, { algorithms: ['HS256'], requiredClaims: ['exp', 'topic', 'data'], currentDate: new Date(now()) });
    if (payload.topic !== 'bits_transaction_receipt' || !isRecord(payload.data)) throw new Error('Not a transaction receipt');
    const data = payload.data, receiptProduct = data.product;
    if (!isRecord(receiptProduct)) throw new Error('No receipt product');
    // Twitch's reference spells this field domainID; deployed product payloads also use domainId.
    const receiptDomain = receiptProduct.domainId ?? receiptProduct.domainID;
    if (receiptDomain !== domain) throw new Error('Wrong extension receipt');
    const parsed = z.object({ transactionId: token, userId: id, time: z.string(), product: z.object({ sku,
      cost: z.object({ amount: receiptAmount, type: z.literal('bits') }), inDevelopment: z.boolean().default(false) }) }).parse(data);
    return { transactionId: parsed.transactionId, personId: parsed.userId, sku: parsed.product.sku,
      bits: parsed.product.cost.amount, inDevelopment: parsed.product.inDevelopment, occurredAt: utc(parsed.time) };
  };
  const durable = (answer: Record<string, unknown>) => ['pending', 'awaiting-target', 'delivered'].includes(String(answer.status));
  let reconciliationBusy = false;
  const api = {
    needs,
    async handle(route: PanelGiftRoute, viewer: PanelViewer, raw: unknown): Promise<GiftApiReply> {
      if (viewer.kind !== 'shared') return reply(403, 'refused', 'Share your Twitch identity to give a gift.');
      try {
        const identity = { kingdomId: viewer.channelId, personId: viewer.personId };
        if (route === 'gifts') {
          z.strictObject({}).parse(raw);
          const answer = await options.realm('/internal/realm/panel/gifts', identity);
          if (answer.status !== 'gifts' || !Array.isArray(answer.offers)) return unavailable();
          return { http: 200, body: { ...answer, offers: needs().length ? [] : answer.offers.filter(value => isRecord(value) && typeof value.sku === 'string' && knownSkus.has(value.sku) && !options.retiredSkus?.has(value.sku)), ...(needs().length ? { message: needs().join(', ') } : {}) } };
        }
        if (route === 'gift-intent') {
          if (needs().length) return unavailable();
          const body = intentBody.parse(raw);
          if (!knownSkus.has(body.sku) || options.retiredSkus?.has(body.sku)) return refused();
          return { http: 200, body: await options.realm('/internal/realm/panel/gift-intent', { ...body, ...identity, extensionId: options.extensionId }) };
        }
        if (route === 'gift-choices') {
          const body = choicesBody.parse(raw);
          return { http: 200, body: await options.realm('/internal/realm/panel/gift-choices', { ...body, ...identity }) };
        }
        if (route === 'gift-resolve') {
          const body = resolveBody.parse(raw);
          return { http: 200, body: await options.realm('/internal/realm/panel/gift-resolve', { ...body, ...identity }) };
        }
        if (route === 'gift-status' || route === 'gift-cancel') {
          const body = statusBody.parse(raw);
          return { http: 200, body: await options.realm(`/internal/realm/panel/${route}`, { ...body, ...identity }) };
        }
        if (needs().length) return unavailable();
        const body = receiptBody.parse(raw);
        let receipt: Receipt;
        try { receipt = await readReceipt(body.receipt); } catch { return refused(); }
        if (receipt.personId !== viewer.personId || !knownSkus.has(receipt.sku)) return refused();
        const row = await canonical(receipt.transactionId);
        if (row.broadcaster_id !== viewer.channelId || row.user_id !== viewer.personId || row.product_data.sku !== receipt.sku
          || row.product_data.cost.amount !== receipt.bits || row.product_data.inDevelopment !== receipt.inDevelopment || utc(row.timestamp) !== receipt.occurredAt) return refused();
        const answer = await record(row, body.intentId);
        return durable(answer) ? { http: 200, body: answer } : refused();
      } catch (error) { return error instanceof z.ZodError ? refused() : unavailable(); }
    },
    async webhook(raw: Uint8Array, headers: Readonly<Record<string, string | undefined>>): Promise<GiftApiReply> {
      const secret = options.webhookSecret;
      if (!secret || secret.length < 32) return unavailable();
      if (raw.byteLength > 64 * 1024) return reply(413, 'refused');
      const get = (name: string) => headers[name] ?? headers[Object.keys(headers).find(key => key.toLowerCase() === name) ?? ''];
      const messageId = get('twitch-eventsub-message-id'), timestamp = get('twitch-eventsub-message-timestamp'), signature = get('twitch-eventsub-message-signature');
      if (!messageId || messageId.length > 200 || !timestamp || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return reply(403, 'refused');
      try {
        let sentAt: number; try { sentAt = utc(timestamp); } catch { return reply(403, 'refused'); }
        if (Math.abs(now() - sentAt) > 600_000) return reply(403, 'refused');
        const expected = `sha256=${createHmac('sha256', secret).update(messageId).update(timestamp).update(raw).digest('hex')}`;
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return reply(403, 'refused');
        if (get('twitch-eventsub-subscription-type') !== 'extension.bits_transaction.create' || get('twitch-eventsub-subscription-version') !== '1') return refused();
        const body = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
        const envelope = z.object({ subscription: z.object({ type: z.literal('extension.bits_transaction.create'), version: z.literal('1'), condition: z.object({ extension_client_id: z.literal(options.extensionId) }) }),
          challenge: z.string().min(1).max(200).optional(), event: z.unknown().optional() }).parse(body);
        const type = get('twitch-eventsub-message-type');
        if (type === 'webhook_callback_verification') return envelope.challenge ? { http: 200, body: envelope.challenge, contentType: 'text/plain' } : refused();
        if (type === 'revocation') return reply(204, 'revoked');
        if (type !== 'notification') return refused();
        const event = z.object({ id: token, extension_client_id: z.literal(options.extensionId), broadcaster_user_id: id, user_id: id,
          product: z.object({ sku, bits: z.int().min(1).max(10_000), in_development: z.boolean() }) }).parse(envelope.event);
        if (!knownSkus.has(event.product.sku)) return refused();
        // Persist before acknowledging. Canonical lookup happens off the webhook's short response budget.
        const answer = await options.realm('/internal/realm/panel/gift-inbox', { extensionId: options.extensionId, transactionId: event.id });
        return answer.status === 'inbox' ? reply(202, 'accepted') : unavailable();
      } catch (error) { return error instanceof z.ZodError || error instanceof SyntaxError ? refused() : unavailable(); }
    },
    async reconcileOnce(): Promise<GiftApiReply> {
      if (reconciliationBusy) return reply(200, 'reconciling');
      if (!options.extensionId || !key) return unavailable();
      reconciliationBusy = true;
      try {
        // Already-verified obligations do not need another provider read or an open panel.
        const drained = await options.realm('/internal/realm/panel/gift-drain', { extensionId: options.extensionId });
        if (drained.status !== 'drained') return unavailable();
        if (needs().length) return unavailable();
        const inbox = await options.realm('/internal/realm/panel/gift-inbox', { extensionId: options.extensionId });
        const jobs = z.object({ status: z.literal('inbox'), transactionIds: z.array(token).max(50) }).parse(inbox);
        let pending = false;
        for (const transactionId of jobs.transactionIds) {
          try {
            const row = await canonical(transactionId);
            if (!knownSkus.has(row.product_data.sku) || !durable(await record(row))) pending = true;
          } catch { pending = true; }
        }
        const cursor = await options.realm('/internal/realm/panel/gift-reconcile', { extensionId: options.extensionId });
        if (cursor.status !== 'cursor' || !(cursor.cursor === null || typeof cursor.cursor === 'string')) return unavailable();
        const newest = await history(); let processed = 0;
        const ingest = async (rows: readonly Transaction[]) => {
          for (const row of rows) {
            if (!knownSkus.has(row.product_data.sku)) continue;
            if (!durable(await record(row))) throw new Error('Evidence was not durably accepted'); processed++;
          }
        };
        await ingest(newest.data);
        // Always overlap the newest page, even while a durable cursor walks older history.
        const page = cursor.cursor ? await history(cursor.cursor) : newest;
        if (cursor.cursor) await ingest(page.data);
        const next = page.pagination?.cursor ?? null;
        const stored = await options.realm('/internal/realm/panel/gift-reconcile', { extensionId: options.extensionId, cursor: next });
        if (stored.status !== 'cursor' || stored.cursor !== next) return unavailable();
        return { http: 200, body: { version: 1, status: 'reconciled', processed, more: next !== null || pending } };
      } catch { return unavailable(); } finally { reconciliationBusy = false; }
    },
    startReconciliation(): () => void {
      if (!options.extensionId || !key) return () => {};
      void api.reconcileOnce();
      const timer = globalThis.setInterval(() => { void api.reconcileOnce(); }, 30_000);
      timer.unref?.();
      return () => globalThis.clearInterval(timer);
    },
  };
  return api;
}
