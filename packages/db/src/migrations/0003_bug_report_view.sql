CREATE TABLE "bug_report_view" (
	"id" text PRIMARY KEY NOT NULL,
	"bug_report_id" text NOT NULL,
	"viewer_key" text NOT NULL,
	"viewer_user_id" text,
	"notified_at" timestamp,
	"notify_attempts" integer DEFAULT 0 NOT NULL,
	"next_notify_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_notify_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bug_report_view" ADD CONSTRAINT "bug_report_view_bug_report_id_bug_report_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_view" ADD CONSTRAINT "bug_report_view_viewer_user_id_user_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bug_report_view_bugReportId_viewerKey_idx" ON "bug_report_view" USING btree ("bug_report_id","viewer_key");--> statement-breakpoint
CREATE INDEX "bug_report_view_nextNotifyAttemptAt_idx" ON "bug_report_view" USING btree ("next_notify_attempt_at");