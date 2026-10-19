import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  // ─── 1. Admin seed ────────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@domera.com';
  const adminPhone = process.env.ADMIN_PHONE || '+998900000000';
  const adminName = process.env.ADMIN_NAME || 'Admin User';
  const rawAdminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

  const hashedAdminPassword = await bcrypt.hash(rawAdminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: hashedAdminPassword,
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      password: hashedAdminPassword,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log(`[SEED SUCCESS] Admin user initialized: ${admin.email} (ID: ${admin.id})`);

  // ─── 2. Agent test account (Flutter developer test) ───────────────────────
  const agentEmail = 'agent.test@domera.uz';
  const agentPhone = '+998901234567';
  const agentName = 'Test Agent';
  const rawAgentPassword = 'DomeraTest123!';

  const hashedAgentPassword = await bcrypt.hash(rawAgentPassword, 10);

  const agent = await prisma.user.upsert({
    where: { email: agentEmail },
    update: {
      // Keep existing password if account already exists, just ensure role is correct
      role: Role.AGENT,
      isActive: true,
      // Update password to ensure it works with the documented credentials
      password: hashedAgentPassword,
    },
    create: {
      name: agentName,
      email: agentEmail,
      phone: agentPhone,
      password: hashedAgentPassword,
      role: Role.AGENT,
      isActive: true,
    },
  });

  console.log(`[SEED SUCCESS] Agent test user initialized: ${agent.email} (ID: ${agent.id})`);
  console.log(`[SEED INFO] Flutter test credentials → email: ${agentEmail} | password: ${rawAgentPassword}`);
}

main()
  .catch((e) => {
    console.error('[SEED ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
