CREATE TABLE "processed_events" (
	"consumer_name" text NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_pkey" PRIMARY KEY("consumer_name","event_id"),
	CONSTRAINT "processed_events_consumer_name_format" CHECK ("processed_events"."consumer_name" ~ '^[a-z][a-z0-9-]{1,62}$')
);
