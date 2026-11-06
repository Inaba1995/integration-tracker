import { TASK_STATUSES, type IntegrationTask } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { AppContext } from './context';
import { audit } from './audit';

export interface TaskInput {
  featureId?: string;
  title?: string;
  status?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  description?: string;
}

export function listTasks(
  ctx: AppContext,
  filter?: { featureId?: string; status?: string },
): Promise<IntegrationTask[]> {
  return ctx.repos.tasks.list(filter);
}

export async function getTask(ctx: AppContext, id: string): Promise<IntegrationTask> {
  const task = await ctx.repos.tasks.byId(id);
  if (!task) {
    throw new DomainError('NOT_FOUND', `Задача ${id} не найдена`);
  }
  return task;
}

export async function createTask(ctx: AppContext, input: TaskInput): Promise<IntegrationTask> {
  const title = input.title?.trim();
  if (!title || !input.featureId) {
    throw new DomainError('VALIDATION', 'featureId и title обязательны');
  }
  if (input.status && !(TASK_STATUSES as readonly string[]).includes(input.status)) {
    throw new DomainError('VALIDATION', `Недопустимый status: ${input.status}`);
  }
  const feature = await ctx.repos.features.byId(input.featureId);
  if (!feature) {
    throw new DomainError('NOT_FOUND', `Фича ${input.featureId} не найдена`);
  }
  if (input.assigneeId) {
    const assignee = await ctx.repos.users.byId(input.assigneeId);
    if (!assignee) {
      throw new DomainError('NOT_FOUND', `Исполнитель ${input.assigneeId} не найден`);
    }
  }

  const task = await ctx.repos.tasks.create({
    featureId: feature.id,
    title,
    status: (input.status as IntegrationTask['status']) ?? 'TODO',
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    description: input.description ?? '',
  });
  await audit(ctx, 'IntegrationTask', task.id, 'CREATE', task);
  return task;
}

export async function updateTask(
  ctx: AppContext,
  id: string,
  input: TaskInput,
): Promise<IntegrationTask> {
  const before = await getTask(ctx, id);
  if (input.status && !(TASK_STATUSES as readonly string[]).includes(input.status)) {
    throw new DomainError('VALIDATION', `Недопустимый status: ${input.status}`);
  }

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.status !== undefined) data.status = input.status;
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.description !== undefined) data.description = input.description;

  const task = await ctx.repos.tasks.update(id, data as Partial<IntegrationTask>);
  await audit(ctx, 'IntegrationTask', id, 'UPDATE', { before, after: task });
  return task;
}
