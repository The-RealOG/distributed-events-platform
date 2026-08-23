CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "attachments_status" CHECK ("attachments"."status" in ('pending', 'ready', 'deleted')),
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_task_ready_idx" ON "attachments" USING btree ("task_id") WHERE "attachments"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "attachments_sweep_idx" ON "attachments" USING btree ("status","created_at") WHERE "attachments"."status" = 'pending' or ("attachments"."status" = 'deleted' and "attachments"."object_deleted_at" is null);