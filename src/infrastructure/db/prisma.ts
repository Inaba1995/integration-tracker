import { PrismaClient } from '@prisma/client';

/**
 * Единственный экземпляр PrismaClient.
 * DATABASE_URL определяет диалект: SQLite (file:*) или PostgreSQL.
 */
export const prisma: PrismaClient = new PrismaClient();

export type Db = PrismaClient;
