const { z } = require('zod');

const uuid = z.string().uuid('must be a valid UUID');
const name = (max = 120) => z.string().trim().min(1, 'must not be empty').max(max);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const roleEnum = z.enum(['ORG_ADMIN', 'TENANT_ADMIN', 'MEMBER']);
const isoDate = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid date')
  .transform((s) => new Date(s));
const version = z.number().int().min(1);

const schemas = {
  idParam: z.object({ id: uuid }),
  register: z.object({
    name: name(),
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8, 'must be at least 8 characters').max(128),
  }),
  login: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }),
  orgCreate: z.object({ name: name() }),
  orgUpdate: z.object({ name: name() }),
  tenantCreate: z.object({ organizationId: uuid, name: name() }),
  tenantUpdate: z.object({ name: name() }),
  tenantList: z.object({ organizationId: uuid }),
  membershipList: z.object({ organizationId: uuid.optional(), tenantId: uuid.optional() })
    .refine((v) => v.organizationId || v.tenantId, 'organizationId or tenantId is required'),
  membershipCreate: z.object({
    email: z.string().trim().toLowerCase().email(),
    organizationId: uuid,
    tenantId: uuid.nullable().optional(),
    role: roleEnum,
  }),
  membershipUpdate: z.object({ role: roleEnum }),
  boardList: z.object({ tenantId: uuid }),
  boardCreate: z.object({ tenantId: uuid, name: name(), description: z.string().max(2000).optional() }),
  boardUpdate: z.object({ name: name().optional(), description: z.string().max(2000).optional() })
    .refine((v) => Object.keys(v).length > 0, 'no fields to update'),
  columnCreate: z.object({ boardId: uuid, name: name(80), position: z.number().int().min(0).optional() }),
  columnUpdate: z.object({ name: name(80).optional(), position: z.number().int().min(0).optional() })
    .refine((v) => Object.keys(v).length > 0, 'no fields to update'),
  columnDelete: z.object({ moveTasksTo: uuid.optional() }),
  taskList: z.object({
    boardId: uuid,
    q: z.string().trim().max(100).optional(),
    assigneeId: uuid.optional(),
    priority: priority.optional(),
  }),
  taskCreate: z.object({
    boardId: uuid,
    columnId: uuid,
    title: name(200),
    description: z.string().max(10000).optional(),
    assignedTo: uuid.nullable().optional(),
    priority: priority.optional(),
    dueDate: isoDate.nullable().optional(),
    position: z.number().int().min(0).optional(),
  }),
  taskUpdate: z.object({
    expectedVersion: version,
    title: name(200).optional(),
    description: z.string().max(10000).optional(),
    assignedTo: uuid.nullable().optional(),
    priority: priority.optional(),
    dueDate: isoDate.nullable().optional(),
  }),
  taskMove: z.object({ expectedVersion: version, columnId: uuid, position: z.number().int().min(0) }),
  taskDelete: z.object({ expectedVersion: version.optional() }),
  activityList: z.object({
    tenantId: uuid,
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.string().datetime().optional(),
    entityType: z.string().max(40).optional(),
    entityId: uuid.optional(),
  }),
  socketJoin: z.object({ tenantId: uuid }),
};

module.exports = schemas;
