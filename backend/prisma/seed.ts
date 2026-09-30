import { PrismaClient } from '@prisma/client';
import { createEtherealAccount } from '../src/services/ethereal.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with initial senders & users...');

  // Default User
  const user = await prisma.user.upsert({
    where: { email: 'demo@reachinbox.com' },
    update: {},
    create: {
      googleId: 'seed-demo-google-id',
      email: 'demo@reachinbox.com',
      name: 'Alex Johnson',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      slackConnected: false,
    },
  });
  console.log(`👤 Created Demo User: ${user.name} (${user.email})`);

  // Create 2 Ethereal SMTP Senders for multi-sender load testing
  const ethereal1 = await createEtherealAccount();
  const sender1 = await prisma.sender.upsert({
    where: { email: 'outreach.alpha@reachinbox.io' },
    update: {},
    create: {
      email: 'outreach.alpha@reachinbox.io',
      name: 'ReachInbox Outreach Alpha',
      hourlyLimit: 5, // Set low limit for easy live rate-limit demo testing!
      smtpHost: ethereal1.smtpHost,
      smtpPort: ethereal1.smtpPort,
      smtpUser: ethereal1.user,
      smtpPass: ethereal1.pass,
    },
  });

  const ethereal2 = await createEtherealAccount();
  const sender2 = await prisma.sender.upsert({
    where: { email: 'growth.beta@reachinbox.io' },
    update: {},
    create: {
      email: 'growth.beta@reachinbox.io',
      name: 'ReachInbox Growth Beta',
      hourlyLimit: 50,
      smtpHost: ethereal2.smtpHost,
      smtpPort: ethereal2.smtpPort,
      smtpUser: ethereal2.user,
      smtpPass: ethereal2.pass,
    },
  });

  console.log(`✉️ Created Multi-Sender 1: ${sender1.name} (Limit: ${sender1.hourlyLimit}/hr)`);
  console.log(`✉️ Created Multi-Sender 2: ${sender2.name} (Limit: ${sender2.hourlyLimit}/hr)`);
  console.log('✅ Database Seeding Completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
