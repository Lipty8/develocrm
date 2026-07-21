import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sharePointSiteId: text("sharepoint_site_id"),
  ...timestamps,
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("users_tenant_email_uq").on(table.tenantId, table.email)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  location: text("location"),
  phase: text("phase").notNull().default("preparation"),
  sharePointFolderId: text("sharepoint_folder_id"),
  ...timestamps,
}, (table) => [uniqueIndex("projects_tenant_code_uq").on(table.tenantId, table.code)]);

export const buildings = sqliteTable("buildings", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  kind: text("kind").notNull().default("building"),
  ...timestamps,
}, (table) => [index("buildings_project_idx").on(table.projectId)]);

export const units = sqliteTable("units", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  buildingId: text("building_id").references(() => buildings.id),
  code: text("code").notNull(),
  disposition: text("disposition").notNull(),
  areaM2: real("area_m2").notNull(),
  floor: text("floor"),
  orientation: text("orientation"),
  commercialStatus: text("commercial_status").notNull().default("available"),
  constructionStatus: text("construction_status").notNull().default("preparation"),
  handoverStatus: text("handover_status").notNull().default("not_planned"),
  currentPriceCzk: integer("current_price_czk").notNull().default(0),
  floorplanDocumentId: text("floorplan_document_id"),
  ...timestamps,
}, (table) => [
  uniqueIndex("units_tenant_project_code_uq").on(table.tenantId, table.projectId, table.code),
  index("units_project_status_idx").on(table.projectId, table.commercialStatus),
]);

export const accessories = sqliteTable("accessories", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  unitId: text("unit_id").references(() => units.id),
  parentAccessoryId: text("parent_accessory_id"),
  type: text("type").notNull(),
  code: text("code").notNull(),
  areaM2: real("area_m2"),
  priceCzk: integer("price_czk").notNull().default(0),
  ...timestamps,
}, (table) => [index("accessories_unit_idx").on(table.unitId)]);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  type: text("type").notNull(),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  companyName: text("company_name"),
  companyId: text("company_id"),
  vatId: text("vat_id"),
  email: text("email"),
  phone: text("phone"),
  bankAccount: text("bank_account"),
  addressJson: text("address_json"),
  ...timestamps,
}, (table) => [index("clients_tenant_name_idx").on(table.tenantId, table.displayName)]);

export const unitClients = sqliteTable("unit_clients", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  role: text("role").notNull().default("buyer"),
  shareNumerator: integer("share_numerator"),
  shareDenominator: integer("share_denominator"),
  validFrom: text("valid_from").notNull().default(sql`CURRENT_TIMESTAMP`),
  validTo: text("valid_to"),
}, (table) => [primaryKey({ columns: [table.unitId, table.clientId, table.validFrom] })]);

export const interests = sqliteTable("interests", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  state: text("state").notNull().default("interest"),
  source: text("source"),
  expiresAt: text("expires_at"),
  endedAt: text("ended_at"),
  note: text("note"),
  ...timestamps,
}, (table) => [index("interests_unit_state_idx").on(table.unitId, table.state)]);

export const priceHistory = sqliteTable("price_history", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  priceCzk: integer("price_czk").notNull(),
  reason: text("reason"),
  validFrom: text("valid_from").notNull().default(sql`CURRENT_TIMESTAMP`),
  changedByUserId: text("changed_by_user_id").references(() => users.id),
}, (table) => [index("price_history_unit_date_idx").on(table.unitId, table.validFrom)]);

export const contracts = sqliteTable("contracts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  workflowState: text("workflow_state").notNull().default("draft"),
  templateId: text("template_id"),
  signedAt: text("signed_at"),
  ownerUserId: text("owner_user_id").references(() => users.id),
  ...timestamps,
}, (table) => [index("contracts_unit_state_idx").on(table.unitId, table.workflowState)]);

export const contractVersions = sqliteTable("contract_versions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  contractId: text("contract_id").notNull().references(() => contracts.id),
  versionNumber: integer("version_number").notNull(),
  sharePointDriveItemId: text("sharepoint_drive_item_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url"),
  source: text("source").notNull().default("crm"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("contract_versions_number_uq").on(table.contractId, table.versionNumber)]);

export const paymentSchedules = sqliteTable("payment_schedules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  contractId: text("contract_id").references(() => contracts.id),
  label: text("label").notNull(),
  sequence: integer("sequence").notNull(),
  amountCzk: integer("amount_czk").notNull(),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("planned"),
  ...timestamps,
}, (table) => [index("payment_schedules_unit_due_idx").on(table.unitId, table.dueAt)]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  scheduleId: text("schedule_id").references(() => paymentSchedules.id),
  amountCzk: integer("amount_czk").notNull(),
  paidAt: text("paid_at").notNull(),
  variableSymbol: text("variable_symbol"),
  bankTransactionId: text("bank_transaction_id"),
  note: text("note"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("payments_schedule_idx").on(table.scheduleId)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  projectId: text("project_id").references(() => projects.id),
  unitId: text("unit_id").references(() => units.id),
  contractId: text("contract_id").references(() => contracts.id),
  handoverId: text("handover_id"),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sharePointDriveItemId: text("sharepoint_drive_item_id").notNull(),
  sharePointVersion: text("sharepoint_version"),
  fileUrl: text("file_url"),
  classified: integer("classified", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("documents_unit_category_idx").on(table.unitId, table.category)]);

export const handovers = sqliteTable("handovers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").notNull().references(() => units.id),
  scheduledAt: text("scheduled_at"),
  state: text("state").notNull().default("preparing"),
  readinessPercent: integer("readiness_percent").notNull().default(0),
  protocolDocumentId: text("protocol_document_id"),
  handedOverAt: text("handed_over_at"),
  ownerUserId: text("owner_user_id").references(() => users.id),
  ...timestamps,
}, (table) => [uniqueIndex("handovers_unit_uq").on(table.unitId)]);

export const handoverItems = sqliteTable("handover_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  handoverId: text("handover_id").notNull().references(() => handovers.id),
  category: text("category").notNull(),
  label: text("label").notNull(),
  value: text("value"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [index("handover_items_handover_idx").on(table.handoverId)]);

export const defects = sqliteTable("defects", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  handoverId: text("handover_id").notNull().references(() => handovers.id),
  title: text("title").notNull(),
  description: text("description"),
  state: text("state").notNull().default("open"),
  dueAt: text("due_at"),
  resolvedAt: text("resolved_at"),
  photoDocumentIdsJson: text("photo_document_ids_json"),
  ...timestamps,
}, (table) => [index("defects_handover_state_idx").on(table.handoverId, table.state)]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id),
  priority: text("priority").notNull().default("medium"),
  dueAt: text("due_at"),
  state: text("state").notNull().default("open"),
  source: text("source").notNull().default("manual"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  index("tasks_assignee_state_due_idx").on(table.assignedToUserId, table.state, table.dueAt),
  index("tasks_object_idx").on(table.objectType, table.objectId),
]);

export const timelineEvents = sqliteTable("timeline_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  unitId: text("unit_id").references(() => units.id),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  actorUserId: text("actor_user_id").references(() => users.id),
  payloadJson: text("payload_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("timeline_unit_created_idx").on(table.unitId, table.createdAt)]);
