CREATE TABLE `decisions` (
	`message_id` text PRIMARY KEY NOT NULL,
	`from` text NOT NULL,
	`subject` text NOT NULL,
	`source` text NOT NULL,
	`rule` text,
	`jev_choice` text,
	`jev_probability` real,
	`add_labels` text NOT NULL,
	`remove_labels` text NOT NULL,
	`trash` integer NOT NULL,
	`dry_run` integer NOT NULL,
	`decided_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mailbox` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`watch_expires_at` integer
);
