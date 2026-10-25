import type { BatchSnapshot, SettlementRepository } from './settlement';
import type { FrozenBatch } from './batch-domain';
export interface StoredBatch { proposal: FrozenBatch; snapshot: BatchSnapshot }
export interface HttpStore {
  settlement: SettlementRepository;
  read(id: string): Promise<StoredBatch | null>;
  list(ownerId: string): Promise<StoredBatch[]>;
  create(proposal: FrozenBatch, snapshot: BatchSnapshot): Promise<void>;
  linkBuyer(pledgeId: string, batchId: string, sessionId: string, now: number): Promise<void>;
  buyerPledges(batchId: string, sessionId: string): Promise<string[]>;
  quota(key: string, limit: number, windowMs: number): Promise<boolean>;
  rememberAnalysis(ownerId: string, digest: string, expiresAt: number): Promise<void>;
  hasAnalysis(ownerId: string, digest: string, now: number): Promise<boolean>;
}

export function settlementRepository(db: D1Database): SettlementRepository {
  return {
    async load(id) {
      const row = await db.prepare('SELECT snapshot FROM batches WHERE id = ?').bind(id).first<{snapshot: string}>();
      return row ? JSON.parse(row.snapshot) as BatchSnapshot : null;
    },
    async acquireLease(id, token, now, until) {
      const result = await db.prepare('UPDATE batches SET lease_token = ?, lease_until = ? WHERE id = ? AND lease_until <= ?').bind(token, until, id, now).run();
      return result.meta.changes === 1;
    },
    async renewLease(id, token, now, until) {
      const result = await db.prepare('UPDATE batches SET lease_until = ? WHERE id = ? AND lease_token = ? AND lease_until > ?').bind(until, id, token, now).run();
      return result.meta.changes === 1;
    },
    async save(next, expected, token, now) {
      if (next.version !== expected + 1) throw new Error('Invalid storage version');
      const result = await db.prepare('UPDATE batches SET snapshot = ?, version = ? WHERE id = ? AND version = ? AND lease_token = ? AND lease_until > ?').bind(JSON.stringify(next), next.version, next.id, expected, token, now).run();
      return result.meta.changes === 1;
    },
    async releaseLease(id, token) {
      await db.prepare('UPDATE batches SET lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?').bind(id, token).run();
    },
  };
}
export async function storedBatch(db: D1Database, id: string): Promise<StoredBatch | null> {
  const row = await db.prepare('SELECT proposal, snapshot FROM batches WHERE id = ?').bind(id).first<{proposal: string; snapshot: string}>();
  return row ? { proposal: JSON.parse(row.proposal), snapshot: JSON.parse(row.snapshot) } : null;
}
export async function saveNewBatch(db: D1Database, proposal: FrozenBatch, snapshot: BatchSnapshot) {
  await db.prepare('INSERT INTO batches (id, owner_id, proposal, snapshot, version, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(snapshot.id, snapshot.ownerId, JSON.stringify(proposal), JSON.stringify(snapshot), snapshot.version, Date.now()).run();
}
export async function consumeQuota(db: D1Database, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO rate_limits (key, count, resets_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN resets_at <= ? THEN 1 ELSE count + 1 END,
    resets_at = CASE WHEN resets_at <= ? THEN ? ELSE resets_at END RETURNING count`)
    .bind(key, now + windowMs, now, now, now + windowMs).first<{count: number}>();
  return !!row && row.count <= limit;
}
export function createHttpStore(db: D1Database): HttpStore {
  return {
    settlement: settlementRepository(db), read: id => storedBatch(db, id),
    async list(ownerId) {
      const rows = await db.prepare('SELECT proposal, snapshot FROM batches WHERE owner_id = ? ORDER BY created_at DESC LIMIT 30').bind(ownerId).all<{proposal: string; snapshot: string}>();
      return (rows.results ?? []).map(row => ({ proposal: JSON.parse(row.proposal), snapshot: JSON.parse(row.snapshot) }));
    },
    create: (proposal, snapshot) => saveNewBatch(db, proposal, snapshot),
    async linkBuyer(pledgeId, batchId, sessionId, now) {
      await db.prepare('INSERT OR IGNORE INTO buyer_sessions (pledge_id, batch_id, session_id, created_at) VALUES (?, ?, ?, ?)').bind(pledgeId, batchId, sessionId, now).run();
    },
    async buyerPledges(batchId, sessionId) {
      const rows = await db.prepare('SELECT pledge_id FROM buyer_sessions WHERE batch_id = ? AND session_id = ?').bind(batchId, sessionId).all<{pledge_id: string}>();
      return (rows.results ?? []).map(row => row.pledge_id);
    },
    quota: (key, limit, windowMs) => consumeQuota(db, key, limit, windowMs),
    async rememberAnalysis(ownerId, digest, expiresAt) {
      await db.prepare('INSERT INTO analysis_receipts (id, owner_id, digest, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at').bind(`${ownerId}:${digest}`, ownerId, digest, expiresAt).run();
    },
    async hasAnalysis(ownerId, digest, now) {
      const row = await db.prepare('SELECT id FROM analysis_receipts WHERE owner_id = ? AND digest = ? AND expires_at > ? LIMIT 1').bind(ownerId, digest, now).first();
      return !!row;
    },
  };
}
