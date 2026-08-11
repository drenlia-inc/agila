import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  description: z.string().max(5000, "Description must be less than 5000 characters"),
  columnId: z.string(),
  memberId: z.string().optional(),
  requesterId: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  effort: z.number().min(0, "Effort must be positive").max(100, "Effort must be less than 100"),
  priority: z.string().min(1, "Priority is required"),
  position: z.number().optional(),
  boardId: z.string().optional(),
});

export const MemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(100, "Name must be less than 100 characters"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color"),
});

export const CommentSchema = z.object({
  text: z.string().min(1, "Comment cannot be empty").max(10000, "Comment must be less than 10000 characters"),
  authorId: z.string(),
  taskId: z.string(),
});

export const BoardSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Board title is required").max(100, "Title must be less than 100 characters"),
  wip_limit: z.number().int().positive().nullable().optional(),
});

export const ColumnSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Column title is required").max(50, "Title must be less than 50 characters"),
  boardId: z.string(),
  is_finished: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  wip_limit: z.number().int().positive().nullable().optional(),
  policy_text: z.string().max(500).nullable().optional(),
});

export type TaskInput = z.infer<typeof TaskSchema>;
export type MemberInput = z.infer<typeof MemberSchema>;
export type CommentInput = z.infer<typeof CommentSchema>;
export type BoardInput = z.infer<typeof BoardSchema>;
export type ColumnInput = z.infer<typeof ColumnSchema>;