ALTER TABLE "bug_report_action" ADD COLUMN "tab_id" integer;--> statement-breakpoint
ALTER TABLE "bug_report_action" ADD COLUMN "page_url" text;--> statement-breakpoint
ALTER TABLE "bug_report_log" ADD COLUMN "tab_id" integer;--> statement-breakpoint
ALTER TABLE "bug_report_log" ADD COLUMN "page_url" text;--> statement-breakpoint
ALTER TABLE "bug_report_network_request" ADD COLUMN "tab_id" integer;--> statement-breakpoint
ALTER TABLE "bug_report_network_request" ADD COLUMN "page_url" text;