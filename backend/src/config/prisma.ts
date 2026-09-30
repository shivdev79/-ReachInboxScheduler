import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function connectDB() {
  try {
    await prisma.$connect();
    console.log('✅ Connected to Prisma Database successfully');
  } catch (error) {
    console.error('❌ Database connection error:', error);
    throw error;
  }
}
