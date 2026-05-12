ALTER TABLE "organization" ADD COLUMN "verified_domain" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "verified_domain_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_verified_domain_uidx" ON "organization" USING btree ("verified_domain") WHERE "organization"."verified_domain" IS NOT NULL;