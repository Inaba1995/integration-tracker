import bcrypt from 'bcryptjs';
import type { Role } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { AppContext } from './context';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Вход по email + пароль (bcrypt). При неудаче — UNAUTHORIZED без деталей. */
export async function login(ctx: AppContext, email: string, password: string): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const user = await ctx.repos.users.byEmail(normalized);
  if (!user) {
    throw new DomainError('UNAUTHORIZED', 'Неверный email или пароль');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new DomainError('UNAUTHORIZED', 'Неверный email или пароль');
  }
  return { id: user.id, email: user.email, role: user.role };
}

export async function me(ctx: AppContext, userId: string): Promise<AuthUser> {
  const user = await ctx.repos.users.byId(userId);
  if (!user) {
    throw new DomainError('UNAUTHORIZED', 'Пользователь не найден');
  }
  return { id: user.id, email: user.email, role: user.role };
}
