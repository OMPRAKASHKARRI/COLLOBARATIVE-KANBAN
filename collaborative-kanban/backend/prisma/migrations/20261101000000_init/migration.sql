-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ORG_ADMIN', 'TENANT_ADMIN', 'MEMBER');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "organizations" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenants" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "token_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "tenant_id" UUID,
  "role" "Role" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
  -- org-level membership (no tenant) must be ORG_ADMIN; tenant-level must not be
  CONSTRAINT "memberships_role_scope_chk" CHECK (
    ("tenant_id" IS NULL AND "role" = 'ORG_ADMIN') OR ("tenant_id" IS NOT NULL AND "role" <> 'ORG_ADMIN')
  )
);

CREATE TABLE "boards" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "columns" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "column_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "assigned_to" UUID,
  "created_by" UUID,
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "due_date" TIMESTAMP(3),
  "position" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_position_chk" CHECK ("position" >= 0),
  CONSTRAINT "tasks_version_chk" CHECK ("version" >= 1)
);

CREATE TABLE "activity_logs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID,
  "entity_type" VARCHAR(40) NOT NULL,
  "entity_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- Unique indexes (also the targets of composite foreign keys)
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "tenants_organization_id_name_key" ON "tenants"("organization_id", "name");
CREATE UNIQUE INDEX "tenants_id_organization_id_key" ON "tenants"("id", "organization_id");
CREATE UNIQUE INDEX "memberships_user_id_organization_id_tenant_id_key" ON "memberships"("user_id", "organization_id", "tenant_id");
-- NULL tenant_id values are distinct in a normal unique index, so enforce one org-level row per user/org:
CREATE UNIQUE INDEX "memberships_org_level_unique" ON "memberships"("user_id", "organization_id") WHERE "tenant_id" IS NULL;
CREATE UNIQUE INDEX "boards_id_tenant_id_key" ON "boards"("id", "tenant_id");
CREATE UNIQUE INDEX "columns_id_board_id_key" ON "columns"("id", "board_id");
CREATE UNIQUE INDEX "columns_id_tenant_id_key" ON "columns"("id", "tenant_id");

-- Query indexes
CREATE INDEX "tenants_organization_id_idx" ON "tenants"("organization_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE INDEX "memberships_tenant_id_idx" ON "memberships"("tenant_id");
CREATE INDEX "memberships_organization_id_idx" ON "memberships"("organization_id");
CREATE INDEX "boards_tenant_id_created_at_idx" ON "boards"("tenant_id", "created_at");
CREATE INDEX "boards_organization_id_idx" ON "boards"("organization_id");
CREATE INDEX "columns_board_id_position_idx" ON "columns"("board_id", "position");
CREATE INDEX "columns_tenant_id_idx" ON "columns"("tenant_id");
CREATE INDEX "tasks_tenant_id_idx" ON "tasks"("tenant_id");
CREATE INDEX "tasks_column_id_position_idx" ON "tasks"("column_id", "position");
CREATE INDEX "tasks_board_id_idx" ON "tasks"("board_id");
CREATE INDEX "tasks_assigned_to_idx" ON "tasks"("assigned_to");
CREATE INDEX "activity_logs_tenant_id_created_at_idx" ON "activity_logs"("tenant_id", "created_at" DESC);
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- Foreign keys. Composite FKs make cross-tenant / cross-board references impossible at the DB level.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- membership.tenant must belong to membership.organization (skipped by MATCH SIMPLE when tenant_id is NULL)
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_org_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "tenants"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "tenants"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "columns" ADD CONSTRAINT "columns_board_id_tenant_id_fkey" FOREIGN KEY ("board_id", "tenant_id") REFERENCES "boards"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_tenant_id_fkey" FOREIGN KEY ("board_id", "tenant_id") REFERENCES "boards"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_column_id_board_id_fkey" FOREIGN KEY ("column_id", "board_id") REFERENCES "columns"("id", "board_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
