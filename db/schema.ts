import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(),
  proposal: text('proposal').notNull(), snapshot: text('snapshot').notNull(),
  version: integer('version').notNull().default(0), leaseToken: text('lease_token'),
  leaseUntil: integer('lease_until').notNull().default(0), createdAt: integer('created_at').notNull(),
});
export const buyerSessions = sqliteTable('buyer_sessions', {
  pledgeId: text('pledge_id').primaryKey(), batchId: text('batch_id').notNull(),
  sessionId: text('session_id').notNull(), createdAt: integer('created_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull().default(0), resetsAt: integer('resets_at').notNull(),
});
export const analysisReceipts = sqliteTable('analysis_receipts', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(),
  digest: text('digest').notNull(), expiresAt: integer('expires_at').notNull(),
});
