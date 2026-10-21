import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createTestApp, createUser, Http, login, resetDb } from './utils';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

describe('Properties, images, favorites, uploads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;
  let agent: { id: string; token: string };
  let otherAgent: { id: string; token: string };
  let user: { id: string; token: string };
  let admin: { id: string; token: string };

  const asUser = async (role: Role) => {
    const u = await createUser(prisma, { role });
    return { id: u.id, token: (await login(http, u.email!)).accessToken };
  };
  const newProperty = (overrides = {}) => ({
    title: 'Office',
    description: 'Nice office',
    propertyType: 'OFFICE',
    purpose: 'RENT',
    price: 1000,
    area: 100,
    address: 'Tashkent',
    ...overrides,
  });
  const createProperty = async (owner: { token: string }, overrides = {}) =>
    (await http().post('/api/properties').set(bearer(owner.token)).send(newProperty(overrides)).expect(201)).body.data;
  const addImage = async (owner: { token: string }, propertyId: string, url: string, extra = {}) =>
    (
      await http()
        .post(`/api/properties/${propertyId}/images`)
        .set(bearer(owner.token))
        .send({ url, ...extra })
        .expect(201)
    ).body.data;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    agent = await asUser(Role.AGENT);
    otherAgent = await asUser(Role.AGENT);
    user = await asUser(Role.USER);
    admin = await asUser(Role.ADMIN);
  });
  afterAll(() => app.close());

  describe('properties', () => {
    it('agent creates; ownerId comes from the token; owner fields are returned', async () => {
      const p = await createProperty(agent);
      expect(p.ownerId).toBe(agent.id);
      expect(p.owner).toMatchObject({ id: agent.id });
      expect(p.owner.password).toBeUndefined();

      await http().post('/api/properties').set(bearer(agent.token)).send(newProperty({ ownerId: user.id })).expect(400);
    });

    it('plain USER cannot create a property', async () => {
      await http().post('/api/properties').set(bearer(user.token)).send(newProperty()).expect(403);
      await http().post('/api/properties').send(newProperty()).expect(401);
    });

    it('only the owner (or admin/manager) can edit or delete', async () => {
      const p = await createProperty(agent);
      await http().patch(`/api/properties/${p.id}`).set(bearer(otherAgent.token)).send({ price: 1 }).expect(403);
      await http().delete(`/api/properties/${p.id}`).set(bearer(otherAgent.token)).expect(403);

      const updated = await http().patch(`/api/properties/${p.id}`).set(bearer(agent.token)).send({ price: 2000 }).expect(200);
      expect(updated.body.data.price).toBe(2000);
      await http().patch(`/api/properties/${p.id}`).set(bearer(admin.token)).send({ price: 3000 }).expect(200);

      await http().delete(`/api/properties/${p.id}`).set(bearer(agent.token)).expect(200);
      await http().get(`/api/properties/${p.id}`).expect(404);
    });

    it('lists public AVAILABLE properties with filters and pagination', async () => {
      await createProperty(agent, { price: 500, latitude: 41.3, longitude: 69.2 });
      await createProperty(agent, { price: 5000, purpose: 'SALE' });
      await createProperty(agent, { status: 'INACTIVE' });

      const all = await http().get('/api/properties').expect(200);
      expect(all.body.data.meta.total).toBe(2);

      const cheap = await http().get('/api/properties?maxPrice=1000').expect(200);
      expect(cheap.body.data.items).toHaveLength(1);

      const onMap = await http().get('/api/properties?minLat=41&maxLat=42&minLng=69&maxLng=70').expect(200);
      expect(onMap.body.data.items).toHaveLength(1);
      const withLocation = await http().get('/api/properties?hasLocation=true').expect(200);
      expect(withLocation.body.data.items).toHaveLength(1);

      const page = await http().get('/api/properties?limit=1&page=2').expect(200);
      expect(page.body.data.items).toHaveLength(1);
      expect(page.body.data.meta).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });

      await http().get('/api/properties?limit=500').expect(400);
      await http().get('/api/properties?minLat=200').expect(400);
      await http().get('/api/properties?propertyType=CASTLE').expect(400);
    });
  });

  describe('images', () => {
    it('adds images, switches the primary image, keeps order', async () => {
      const p = await createProperty(agent);
      await addImage(agent, p.id, '/uploads/properties/a.jpg', { isPrimary: true, sortOrder: 1 });
      await addImage(agent, p.id, '/uploads/properties/b.jpg', { isPrimary: true, sortOrder: 0 });

      const res = await http().get(`/api/properties/${p.id}/images`).expect(200);
      expect(res.body.data.map((i: any) => [i.url, i.isPrimary])).toEqual([
        ['/uploads/properties/b.jpg', true],
        ['/uploads/properties/a.jpg', false],
      ]);
      await http().post(`/api/properties/${p.id}/images`).set(bearer(otherAgent.token)).send({ url: '/x.jpg' }).expect(403);
    });

    it('deleting one image keeps the property and its other images (both routes)', async () => {
      const p = await createProperty(agent);
      const a = await addImage(agent, p.id, '/uploads/properties/a.jpg');
      const b = await addImage(agent, p.id, '/uploads/properties/b.jpg');
      const c = await addImage(agent, p.id, '/uploads/properties/c.jpg');

      await http().delete(`/api/properties/${p.id}/images/${a.id}`).set(bearer(agent.token)).expect(200);
      await http().delete(`/api/properties/images/${b.id}`).set(bearer(agent.token)).expect(200);

      const left = await prisma.propertyImage.findMany({ where: { propertyId: p.id } });
      expect(left.map((i) => i.id)).toEqual([c.id]);
      expect(await prisma.property.findUnique({ where: { id: p.id } })).not.toBeNull();
    });

    it('rejects deleting an image through another property, by a non-owner, or unknown ids', async () => {
      const p1 = await createProperty(agent);
      const p2 = await createProperty(agent);
      const img = await addImage(agent, p1.id, '/uploads/properties/a.jpg');

      await http().delete(`/api/properties/${p2.id}/images/${img.id}`).set(bearer(agent.token)).expect(404);
      await http().delete(`/api/properties/${p1.id}/images/${img.id}`).set(bearer(otherAgent.token)).expect(403);
      await http().delete(`/api/properties/images/${img.id}`).set(bearer(otherAgent.token)).expect(403);
      await http().delete(`/api/properties/${p1.id}/images/${randomUUID()}`).set(bearer(agent.token)).expect(404);
      expect(await prisma.propertyImage.count()).toBe(1);
    });

    it('never deletes files outside the uploads directory', async () => {
      const victim = path.join(process.cwd(), 'e2e-victim.txt');
      fs.writeFileSync(victim, 'keep me');
      try {
        const p = await createProperty(agent);
        const img = await addImage(agent, p.id, '/uploads/../e2e-victim.txt');
        await http().delete(`/api/properties/${p.id}/images/${img.id}`).set(bearer(agent.token)).expect(200);
        expect(fs.existsSync(victim)).toBe(true);
      } finally {
        fs.rmSync(victim, { force: true });
      }
    });
  });

  describe('uploads', () => {
    it('accepts a real PNG and stores it with a server-chosen extension', async () => {
      const res = await http()
        .post('/api/uploads/image')
        .set(bearer(agent.token))
        .attach('file', PNG, { filename: 'evil.html', contentType: 'image/png' })
        .expect(201);
      expect(res.body.data.url).toMatch(/^\/uploads\/properties\/[0-9a-f-]+\.png$/);
      const stored = path.join(process.cwd(), res.body.data.url);
      expect(fs.existsSync(stored)).toBe(true);

      // Uploaded file is cleaned up when its image row is deleted
      const p = await createProperty(agent);
      const img = await addImage(agent, p.id, res.body.data.url);
      await http().delete(`/api/properties/${p.id}/images/${img.id}`).set(bearer(agent.token)).expect(200);
      expect(fs.existsSync(stored)).toBe(false);
    });

    it('rejects non-image content, wrong types, oversized files and anonymous users', async () => {
      await http()
        .post('/api/uploads/image')
        .set(bearer(agent.token))
        .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
      await http()
        .post('/api/uploads/image')
        .set(bearer(agent.token))
        .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' })
        .expect(400);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1)]);
      const tooBig = await http()
        .post('/api/uploads/image')
        .set(bearer(agent.token))
        .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
      expect([400, 413]).toContain(tooBig.status);
      await http().post('/api/uploads/image').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(401);
    });
  });

  describe('favorites', () => {
    it('adds, rejects duplicates, lists and removes only for the current user', async () => {
      const p = await createProperty(agent);
      await http().post(`/api/favorites/${p.id}`).set(bearer(user.token)).expect(201);
      await http().post(`/api/favorites/${p.id}`).set(bearer(user.token)).expect(409);
      await http().post(`/api/favorites/${randomUUID()}`).set(bearer(user.token)).expect(404);

      const mine = await http().get('/api/favorites').set(bearer(user.token)).expect(200);
      expect(mine.body.data.items.map((i: any) => i.id)).toEqual([p.id]);
      const theirs = await http().get('/api/favorites').set(bearer(otherAgent.token)).expect(200);
      expect(theirs.body.data.items).toEqual([]);

      await http().delete(`/api/favorites/${p.id}`).set(bearer(otherAgent.token)).expect(404);
      await http().delete(`/api/favorites/${p.id}`).set(bearer(user.token)).expect(200);
      expect(await prisma.favorite.count()).toBe(0);
    });

    it('concurrent duplicate favorites produce one row and no 500', async () => {
      const p = await createProperty(agent);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => http().post(`/api/favorites/${p.id}`).set(bearer(user.token))),
      );
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(await prisma.favorite.count()).toBe(1);
    });
  });
});
