CREATE TABLE "outbox_events" (
	"sequence_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_sequence_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"partition_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	CONSTRAINT "outbox_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "outbox_events_attempt_count_nonnegative" CHECK ("outbox_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_seq_idx" ON "outbox_events" USING btree ("sequence_id") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_key_seq_idx" ON "outbox_events" USING btree ("partition_key","sequence_id") WHERE "outbox_events"."published_at" is null;