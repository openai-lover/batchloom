CREATE TABLE `analysis_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`digest` text NOT NULL,
	`expires_at` integer NOT NULL
);
