import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@domera.com';
  const adminPhone = process.env.ADMIN_PHONE || '+998900000000';
  const adminName = process.env.ADMIN_NAME || 'Admin User';
  const rawPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: hashedPassword,
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      password: hashedPassword,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log(`[SEED SUCCESS] Admin user initialized: ${admin.email} (ID: ${admin.id})`);
}

main()
  .catch((e) => {
    console.error('[SEED ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
