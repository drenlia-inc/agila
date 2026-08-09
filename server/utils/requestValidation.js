import { z } from 'zod';

/**
 * Parse req.body with a Zod schema. Returns { success, data } or { success: false, error }.
 */
export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    const message = `${path}${issue?.message || 'Invalid request body'}`;
    return { success: false, error: message, issues: result.error.issues };
  }
  return { success: true, data: result.data };
}

const idSchema = z.string().min(1).max(128);

/** FE often sends "" for cleared fields; priorityId may be a number from the DB/API. */
const optionalNullableId = z.preprocess((v) => {
  if (v === '' || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return v;
}, z.union([idSchema, z.null()]).optional());

const optionalDate = z.preprocess(
  (v) => (v === '' ? null : v),
  z.union([z.string().max(64), z.null()]).optional()
);

const effortSchema = z.union([z.number(), z.string().max(32), z.null()]).optional();

/** DB / FE may send 0/1 or "true"/"false" for blocked flags. */
const booleanish = z.preprocess((v) => {
  if (v === 0 || v === '0' || v === 'false' || v === false) return false;
  if (v === 1 || v === '1' || v === 'true' || v === true) return true;
  return v;
}, z.boolean().optional());

/** Standard emails, plus reserved *@local pseudo accounts (system@local, agent@local). */
const emailOrLocalSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .refine(
    (v) => /^[^\s@]+@local$/.test(v) || z.string().email().safeParse(v).success,
    { message: 'Invalid email address' }
  );

const attachmentSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  url: z.string().min(1).max(2048),
  type: z.string().min(1).max(256),
  size: z.number().int().nonnegative().max(500 * 1024 * 1024)
});

/** Comment create — authorId from client is ignored (bound server-side). */
export const createCommentBodySchema = z.object({
  id: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  text: z.string().min(1, 'Comment cannot be empty').max(10000, 'Comment must be less than 10000 characters'),
  createdAt: z.union([z.string().min(1), z.number()]).optional(),
  attachments: z.array(attachmentSchema).max(50).optional()
}).passthrough();

export const updateCommentBodySchema = z.object({
  text: z.string().min(1, 'Comment cannot be empty').max(10000, 'Comment must be less than 10000 characters')
});

export const loginBodySchema = z.object({
  email: z.string().trim().email('Valid email is required').max(320),
  password: z.string().min(1, 'Password is required').max(1024)
});

export const passwordResetRequestBodySchema = z.object({
  email: z.string().trim().email('Valid email is required').max(320)
});

export const passwordResetCompleteBodySchema = z.object({
  token: z.string().min(1).max(256),
  newPassword: z.string().min(6, 'Password must be at least 6 characters long').max(1024)
});

/** Task create / add-at-top — core fields required; extras passthrough for FE compatibility. */
export const createTaskBodySchema = z.object({
  id: idSchema,
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(500_000).optional(),
  memberId: optionalNullableId,
  requesterId: optionalNullableId,
  startDate: optionalDate,
  dueDate: optionalDate,
  effort: effortSchema,
  priority: z.union([z.string().max(100), z.null()]).optional(),
  priorityId: optionalNullableId,
  columnId: idSchema,
  boardId: idSchema,
  position: z.union([z.number(), z.string().max(32)]).optional(),
  sprintId: optionalNullableId
}).passthrough();

/** Task update — partial; known fields constrained; unknown keys allowed. */
export const updateTaskBodySchema = z.object({
  id: idSchema.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.union([z.string().max(500_000), z.null()]).optional(),
  memberId: optionalNullableId,
  requesterId: optionalNullableId,
  startDate: optionalDate,
  dueDate: optionalDate,
  effort: effortSchema,
  priority: z.union([z.string().max(100), z.null()]).optional(),
  priorityId: optionalNullableId,
  columnId: z.preprocess((v) => (v === '' ? undefined : v), idSchema.optional()),
  boardId: z.preprocess((v) => (v === '' ? undefined : v), idSchema.optional()),
  position: z.union([z.number(), z.string().max(32), z.null()]).optional(),
  sprintId: optionalNullableId,
  isBlocked: booleanish,
  blockedReason: z.union([z.string().max(2000), z.null()]).optional(),
  skipActivity: z.boolean().optional()
}).passthrough();

export const copyTaskBodySchema = z.object({
  taskId: idSchema,
  boardId: idSchema.optional()
}).passthrough();

export const bulkFieldActivityBodySchema = z.object({
  field: z.enum(['memberId', 'requesterId', 'priorityId', 'sprintId']),
  taskIds: z.array(idSchema).min(1).max(500),
  newValue: z.preprocess(
    (v) => (v === '' ? null : v),
    z.union([z.string().max(128), z.null()]).optional()
  ),
  oldValue: z.preprocess(
    (v) => (v === '' ? null : v),
    z.union([z.string().max(128), z.null()]).optional()
  ),
  newLabel: z.union([z.string().max(500), z.null()]).optional(),
  boardId: optionalNullableId
});

export const batchUpdateTasksBodySchema = z.object({
  tasks: z.array(
    z.object({
      id: idSchema
    }).passthrough()
  ).min(1).max(500)
});

export const batchUpdatePositionsBodySchema = z.object({
  updates: z.array(
    z.object({
      taskId: idSchema,
      position: z.union([z.number(), z.string().max(32)]),
      columnId: idSchema.optional()
    }).passthrough()
  ).min(1).max(2000)
});

export const reorderTaskBodySchema = z.object({
  taskId: idSchema,
  newPosition: z.union([z.number(), z.string().max(32)]),
  columnId: idSchema
}).passthrough();

export const moveTaskToBoardBodySchema = z.object({
  taskId: idSchema,
  targetBoardId: idSchema
});

export const permanentBatchBodySchema = z.object({
  taskIds: z.array(idSchema).min(1).max(500)
});

export const adminCreateUserBodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email is required').max(320),
  // Invite (inactive) may omit password; active local create still needs one (enforced in route).
  password: z.string().max(1024).optional().default(''),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  role: z.enum(['admin', 'user', 'viewer'], { message: 'User role is required' }),
  displayName: z.string().max(100).optional(),
  isActive: booleanish,
  baseUrl: z.string().max(2048).optional()
}).passthrough();

export const adminUpdateUserBodySchema = z.object({
  email: emailOrLocalSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  isActive: booleanish
}).passthrough();

/** Accept either `{ role }` (Admin.tsx) or `{ action: promote|demote }` (api helper). */
export const adminUpdateUserRoleBodySchema = z.union([
  z.object({ role: z.enum(['admin', 'user', 'viewer']) }),
  z.object({ action: z.enum(['promote', 'demote']) }).transform(({ action }) => ({
    role: action === 'promote' ? 'admin' : 'user'
  }))
]);

// —— Boards / columns ——

export const createBoardBodySchema = z.object({
  id: idSchema,
  title: z.string().min(1, 'Board title is required').max(200)
}).passthrough();

export const updateBoardBodySchema = z.object({
  title: z.string().min(1, 'Board title is required').max(200)
}).passthrough();

export const reorderBoardBodySchema = z.object({
  boardId: idSchema,
  newPosition: z.union([z.number(), z.string().max(32)])
}).passthrough();

export const createColumnBodySchema = z.object({
  id: idSchema,
  title: z.string().min(1, 'Column title is required').max(200),
  boardId: idSchema,
  position: z.union([z.number(), z.string().max(32), z.null()]).optional()
}).passthrough();

export const updateColumnBodySchema = z.object({
  title: z.string().min(1, 'Column title is required').max(200),
  is_finished: booleanish,
  is_archived: booleanish,
  wip_limit: z.union([z.number(), z.string().max(32), z.null()]).optional(),
  policy_text: z.union([z.string().max(2000), z.null()]).optional()
}).passthrough();

export const reorderColumnBodySchema = z.object({
  columnId: idSchema,
  newPosition: z.union([z.number(), z.string().max(32)]),
  boardId: idSchema
}).passthrough();

export const renumberColumnsBodySchema = z.object({
  boardId: idSchema
}).passthrough();

// —— Settings ——

const settingValueSchema = z.union([
  z.string().max(100_000),
  z.number(),
  z.boolean(),
  z.null()
]);

export const updateSettingBodySchema = z.object({
  // SCREAMING_SNAKE only — rejects React SyntheticEvent props accidentally POSTed as keys
  key: z
    .string()
    .min(1, 'Setting key is required')
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Setting key must be SCREAMING_SNAKE_CASE'),
  value: settingValueSchema
}).passthrough();

export const bulkUpdateSettingsBodySchema = z.object({
  settings: z.record(
    z.string().max(128).regex(/^[A-Z][A-Z0-9_]*$/, 'Setting key must be SCREAMING_SNAKE_CASE'),
    settingValueSchema
  )
});

export const updateAppUrlBodySchema = z.object({
  appUrl: z.string().min(1).max(2048)
}).passthrough();

// —— Tags / priorities / sprints / members ——

export const createTagBodySchema = z.object({
  tag: z.string().min(1, 'Tag name is required').max(100),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional()
}).passthrough();

export const updateTagBodySchema = createTagBodySchema;

export const createPriorityBodySchema = z.object({
  priority: z.string().min(1, 'Priority name is required').max(100),
  color: z.string().min(1, 'Color is required').max(32)
}).passthrough();

export const updatePriorityBodySchema = createPriorityBodySchema;

export const reorderPrioritiesBodySchema = z.object({
  priorities: z
    .array(
      z
        .object({
          id: z.union([z.number(), z.string().min(1).max(128)])
        })
        .passthrough()
    )
    .min(1)
    .max(100)
});

export const createSprintBodySchema = z.object({
  name: z.string().min(1, 'Sprint name is required').max(200),
  start_date: z.string().min(1, 'Start date is required').max(64),
  end_date: z.string().min(1, 'End date is required').max(64),
  is_active: booleanish,
  description: z.union([z.string().max(5000), z.null()]).optional()
}).passthrough();

export const updateSprintBodySchema = createSprintBodySchema;

export const createMemberBodySchema = z.object({
  id: idSchema,
  name: z.string().min(1, 'Member name is required').max(100),
  color: z.string().min(1, 'Color is required').max(32)
}).passthrough();

// —— Auth extras / user profile / settings ——

export const activateAccountBodySchema = z.object({
  token: z.string().min(1).max(256),
  email: z.string().trim().email('Valid email is required').max(320),
  newPassword: z.string().min(6, 'Password must be at least 6 characters long').max(1024)
});

export const registerBodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email is required').max(320),
  password: z.string().min(1, 'Password is required').max(1024),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  role: z.enum(['admin', 'user', 'viewer'], { message: 'User role is required' })
});

export const updateProfileBodySchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(30),
  /** Optional short memo; empty string clears. Max 280 chars. */
  bio: z.string().max(280).optional()
});

/** One user preference per request; value may be JSON-serializable. */
export const updateUserSettingBodySchema = z.object({
  setting_key: z.string().min(1, 'Setting key is required').max(128),
  setting_value: z
    .union([
      z.string().max(100_000),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.any()),
      z.record(z.string(), z.any())
    ])
    .optional()
}).passthrough();

export const updateMemberNameBodySchema = updateProfileBodySchema;

export const updateMemberColorBodySchema = z.object({
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format. Use hex format like #FF5733')
});

export const resendInvitationBodySchema = z.object({
  baseUrl: z.string().max(2048).optional()
}).passthrough();

// —— Saved filter views ——

const viewFilterValue = z.union([
  z.string().max(5000),
  z.null(),
  z.array(z.union([z.string().max(256), z.number()])).max(500)
]);

export const viewFiltersSchema = z
  .object({
    textFilter: viewFilterValue.optional(),
    dateFromFilter: viewFilterValue.optional(),
    dateToFilter: viewFilterValue.optional(),
    dueDateFromFilter: viewFilterValue.optional(),
    dueDateToFilter: viewFilterValue.optional(),
    memberFilters: viewFilterValue.optional(),
    priorityFilters: viewFilterValue.optional(),
    tagFilters: viewFilterValue.optional(),
    projectFilter: viewFilterValue.optional(),
    taskFilter: viewFilterValue.optional(),
    boardColumnFilter: viewFilterValue.optional()
  })
  .passthrough();

export const createViewBodySchema = z.object({
  filterName: z.string().trim().min(1, 'Filter name is required').max(200),
  filters: viewFiltersSchema,
  shared: booleanish
}).passthrough();

export const updateViewBodySchema = z.object({
  filterName: z.string().trim().min(1).max(200).optional(),
  filters: viewFiltersSchema.optional(),
  shared: booleanish
}).passthrough();

// —— Task attachments / relationships ——

export const taskAttachmentsBodySchema = z.object({
  attachments: z.array(attachmentSchema).min(1).max(50)
});

export const createTaskRelationshipBodySchema = z.object({
  relationship: z.enum(['child', 'parent', 'related']),
  toTaskId: idSchema
});

// —— Task work / agent control ——

export const updateTaskWorkBodySchema = z
  .object({
    repoUrl: z.string().max(2048).optional(),
    repoBranch: z.string().max(256).optional(),
    status: z.string().max(64).optional(),
    agentMode: z.string().max(64).optional(),
    automationScope: z.string().max(64).optional(),
    automationBoardIds: z
      .union([z.array(idSchema).max(100), z.string().max(4000)])
      .optional(),
    llmModel: z.string().max(128).optional(),
    entries: z
      .record(
        z.string().max(128),
        z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()])
      )
      .optional()
  })
  .passthrough();

export const taskWorkControlBodySchema = z.object({
  control: z.preprocess(
    (v) => String(v ?? '').toLowerCase(),
    z.enum(['pause', 'stop', 'resume', 'none', 'apply'])
  )
});

export const taskIdsBatchBodySchema = permanentBatchBodySchema;

export const boardIdsBatchBodySchema = z.object({
  boardIds: z.array(idSchema).min(1).max(500)
});

export const workMapsBodySchema = z.object({
  taskIds: z.array(idSchema).max(500).default([])
});

// —— User /dev (PAT, GitHub) ——

export const createDevTokenBodySchema = z.object({
  name: z.string().max(100).optional()
}).passthrough();

export const githubTokenBodySchema = z.object({
  token: z.string().trim().min(20).max(255)
});

export const githubRepoProbeBodySchema = z.object({
  repoUrl: z.string().trim().min(1).max(2048)
});

// —— Admin AI / storage / notifications ——

export const aiCredentialsDraftBodySchema = z
  .object({
    provider: z.string().max(64).optional(),
    baseUrl: z.string().max(2048).optional(),
    apiKey: z.string().max(4096).optional(),
    model: z.string().max(256).optional()
  })
  .passthrough();

export const aiRunnerProbeBodySchema = z
  .object({
    runnerUrl: z.string().max(2048).optional(),
    runnerToken: z.string().max(4096).optional()
  })
  .passthrough();

export const jobsCleanupBodySchema = z
  .object({
    retentionDays: z.union([z.number().int().positive().max(3650), z.string().max(16)]).optional()
  })
  .passthrough();

export const s3TestOverridesBodySchema = z
  .object({
    S3_ENDPOINT: z.string().max(2048).optional(),
    S3_REGION: z.string().max(64).optional(),
    S3_BUCKET: z.string().max(256).optional(),
    S3_ACCESS_KEY_ID: z.string().max(512).optional(),
    S3_SECRET_ACCESS_KEY: z.string().max(512).optional(),
    S3_FORCE_PATH_STYLE: z.union([z.boolean(), z.string().max(16)]).optional(),
    S3_KEY_PREFIX: z.string().max(512).optional(),
    /** Probe a destination draft without writing STORAGE_TEST_OK or merging live secrets. */
    asDestination: booleanish
  })
  .passthrough();

const s3DestinationFieldsSchema = z.object({
  S3_ENDPOINT: z.string().max(2048).optional(),
  S3_REGION: z.string().max(64).optional(),
  S3_BUCKET: z.string().max(256),
  S3_ACCESS_KEY_ID: z.string().max(512),
  S3_SECRET_ACCESS_KEY: z.string().max(512),
  S3_FORCE_PATH_STYLE: z.union([z.boolean(), z.string().max(16)]).optional(),
  S3_KEY_PREFIX: z.string().max(512).optional()
});

export const migrateStorageBodySchema = z
  .object({
    direction: z.enum(['disk-to-s3', 's3-to-disk', 's3-to-s3']),
    deleteSource: booleanish,
    /** Required for s3-to-s3: destination bucket (source = current live settings). */
    destination: s3DestinationFieldsSchema.optional()
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (val.direction === 's3-to-s3' && !val.destination) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'destination is required for s3-to-s3',
        path: ['destination']
      });
    }
  });

export const notificationIdsBodySchema = z.object({
  notificationIds: z
    .array(z.union([z.string().min(1).max(128), z.number().int()]))
    .min(1)
    .max(500)
});

// —— Agent automation API ——

export const agentClaimBodySchema = z
  .object({
    runnerId: z.string().max(128).optional()
  })
  .passthrough();

export const agentMoveTaskBodySchema = z.object({
  columnId: idSchema,
  position: z.union([z.number(), z.string().max(32)]).optional()
}).passthrough();

export const agentCommentBodySchema = z.object({
  text: z.string().min(1).max(10000),
  id: idSchema.optional(),
  markWaiting: booleanish
}).passthrough();

export const agentAttachmentsBodySchema = z.object({
  attachments: z
    .array(
      z.object({
        id: idSchema.optional(),
        name: z.string().min(1).max(512),
        url: z.string().min(1).max(2048),
        type: z.string().min(1).max(256),
        size: z.number().int().nonnegative().max(500 * 1024 * 1024).optional()
      })
    )
    .min(1)
    .max(50)
});

export const agentPatchTaskBodySchema = z
  .object({
    priority: z.union([z.string().max(100), z.null()]).optional(),
    priorityId: optionalNullableId,
    priority_id: optionalNullableId,
    effort: effortSchema,
    startDate: optionalDate,
    startdate: optionalDate,
    dueDate: optionalDate,
    duedate: optionalDate,
    columnId: idSchema.optional(),
    columnid: idSchema.optional(),
    sprintId: optionalNullableId,
    sprint_id: optionalNullableId,
    title: z.any().optional(),
    description: z.any().optional()
  })
  .passthrough();

export const agentUpdateWorkBodySchema = z
  .object({
    entries: z
      .record(
        z.string().max(128),
        z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()])
      )
      .optional(),
    appendLog: z.string().max(100_000).optional()
  })
  .passthrough();

export const agentToolCallBodySchema = z.object({
  name: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.any()).optional(),
  args: z.record(z.string(), z.any()).optional(),
  dryRun: booleanish
}).passthrough();

export const agentRunnerCallbackBodySchema = z
  .object({
    taskId: idSchema,
    event: z.string().min(1).max(64),
    jobId: z.string().max(128).optional(),
    progress: z.union([z.number(), z.string().max(32)]).optional(),
    log: z.string().max(100_000).optional(),
    comment: z.string().max(10000).optional(),
    status: z.string().max(64).optional(),
    prUrl: z.string().max(2048).optional(),
    branch: z.string().max(256).optional(),
    callbackToken: z.string().max(512).optional()
  })
  .passthrough();
