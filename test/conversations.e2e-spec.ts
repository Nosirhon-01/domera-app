import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConversationsService } from '../src/conversations/conversations.service';
import { bearer, createTestApp, createUser, Http, login, resetDb } from './utils';

describe('Conversations & messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let eve: { id: string; token: string };

  const asUser = async (opts = {}) => {
    const u = await createUser(prisma, opts);
    return { id: u.id, token: (await login(http, u.email!)).accessToken };
  };
  const startChat = async (from: { token: string }, to: { id: string }) =>
    (await http().post('/api/conversations').set(bearer(from.token)).send({ participantId: to.id }).expect(201)).body
      .data;
  const send = (from: { token: string }, conversationId: string, content: string) =>
    http().post(`/api/conversations/${conversationId}/messages`).set(bearer(from.token)).send({ content });

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    alice = await asUser();
    bob = await asUser();
    eve = await asUser();
  });
  afterAll(() => app.close());

  describe('POST /conversations', () => {
    it('creates once and returns the same conversation afterwards (either side)', async () => {
      const first = await startChat(alice, bob);
      const again = await startChat(alice, bob);
      const fromBob = await startChat(bob, alice);
      expect(again.id).toBe(first.id);
      expect(fromBob.id).toBe(first.id);
      expect(first.otherParticipants.map((p: any) => p.id)).toEqual([bob.id]);
      expect(await prisma.conversation.count()).toBe(1);
    });

    it('does not create duplicates under concurrent requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          http()
            .post('/api/conversations')
            .set(bearer(i % 2 ? alice.token : bob.token))
            .send({ participantId: i % 2 ? bob.id : alice.id }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await prisma.conversation.count()).toBe(1);
      expect(await prisma.conversationParticipant.count()).toBe(2);
    });

    it('does not create duplicates under heavy concurrency (service level)', async () => {
      const service = app.get(ConversationsService);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          i % 2
            ? service.createOrGetConversation(alice.id, { participantId: bob.id })
            : service.createOrGetConversation(bob.id, { participantId: alice.id }),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await prisma.conversation.count()).toBe(1);
    });

    it('rejects self, unknown, inactive and invalid participants', async () => {
      await http().post('/api/conversations').set(bearer(alice.token)).send({ participantId: alice.id }).expect(400);
      await http().post('/api/conversations').set(bearer(alice.token)).send({ participantId: randomUUID() }).expect(404);
      const inactive = await createUser(prisma, { isActive: false });
      await http().post('/api/conversations').set(bearer(alice.token)).send({ participantId: inactive.id }).expect(404);
      await http().post('/api/conversations').set(bearer(alice.token)).send({ participantId: 'not-a-uuid' }).expect(400);
    });

    it('requires authentication', async () => {
      await http().post('/api/conversations').send({ participantId: bob.id }).expect(401);
      await http().get('/api/conversations').expect(401);
    });
  });

  describe('access control', () => {
    it('hides conversations and messages from non-participants (404, not 403)', async () => {
      const chat = await startChat(alice, bob);
      await send(alice, chat.id, 'secret').expect(201);

      await http().get(`/api/conversations/${chat.id}`).set(bearer(eve.token)).expect(404);
      await http().get(`/api/conversations/${chat.id}/messages`).set(bearer(eve.token)).expect(404);
      await send(eve, chat.id, 'intrusion').expect(404);
      await http().patch(`/api/conversations/${chat.id}/read`).set(bearer(eve.token)).expect(404);

      const eveList = await http().get('/api/conversations').set(bearer(eve.token)).expect(200);
      expect(eveList.body.data.items).toEqual([]);
      expect(await prisma.message.count()).toBe(1);
    });

    it('returns 404 for unknown conversation ids', async () => {
      await http().get(`/api/conversations/${randomUUID()}`).set(bearer(alice.token)).expect(404);
      await http().get(`/api/conversations/${randomUUID()}/messages`).set(bearer(alice.token)).expect(404);
    });
  });

  describe('messages', () => {
    it('sends with senderId from the token and lists oldest first', async () => {
      const chat = await startChat(alice, bob);
      await send(alice, chat.id, '  first  ').expect(201);
      const spoof = await http()
        .post(`/api/conversations/${chat.id}/messages`)
        .set(bearer(bob.token))
        .send({ content: 'second', senderId: alice.id });
      expect(spoof.status).toBe(400); // unknown field rejected — cannot spoof the sender

      await send(bob, chat.id, 'second').expect(201);
      const res = await http().get(`/api/conversations/${chat.id}/messages`).set(bearer(alice.token)).expect(200);
      expect(res.body.data.items.map((m: any) => [m.content, m.senderId])).toEqual([
        ['first', alice.id],
        ['second', bob.id],
      ]);
      expect(res.body.data.meta.total).toBe(2);
    });

    it('validates content', async () => {
      const chat = await startChat(alice, bob);
      await send(alice, chat.id, '').expect(400);
      await send(alice, chat.id, '    ').expect(400);
      await send(alice, chat.id, 'x'.repeat(5001)).expect(400);
    });

    it('validates pagination', async () => {
      const chat = await startChat(alice, bob);
      await http().get(`/api/conversations/${chat.id}/messages?limit=1000`).set(bearer(alice.token)).expect(400);
      await http().get(`/api/conversations/${chat.id}/messages?page=0`).set(bearer(alice.token)).expect(400);
      const empty = await http().get(`/api/conversations/${chat.id}/messages`).set(bearer(alice.token)).expect(200);
      expect(empty.body.data).toEqual({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    });
  });

  describe('unread counts and read receipts', () => {
    it('counts only unread messages from the other participant', async () => {
      const chat = await startChat(alice, bob);
      await send(alice, chat.id, 'a1').expect(201);
      await send(alice, chat.id, 'a2').expect(201);
      await send(bob, chat.id, 'b1').expect(201);

      const bobList = await http().get('/api/conversations').set(bearer(bob.token)).expect(200);
      const aliceList = await http().get('/api/conversations').set(bearer(alice.token)).expect(200);
      expect(bobList.body.data.items[0].unreadCount).toBe(2);
      expect(aliceList.body.data.items[0].unreadCount).toBe(1);
      expect(aliceList.body.data.items[0].lastMessage.content).toBe('b1');

      const bobOne = await http().get(`/api/conversations/${chat.id}`).set(bearer(bob.token)).expect(200);
      expect(bobOne.body.data.unreadCount).toBe(2);

      // Re-opening an existing chat via POST also reports the real unread count
      const reopened = await startChat(bob, alice);
      expect(reopened.unreadCount).toBe(2);
    });

    it('empty conversation has zero unread and no last message', async () => {
      await startChat(alice, bob);
      const list = await http().get('/api/conversations').set(bearer(bob.token)).expect(200);
      expect(list.body.data.items[0]).toMatchObject({ unreadCount: 0, lastMessage: null });
    });

    it("PATCH /conversations/:id/read marks only the other side's messages and is idempotent", async () => {
      const chat = await startChat(alice, bob);
      await send(alice, chat.id, 'a1').expect(201);
      await send(alice, chat.id, 'a2').expect(201);
      await send(bob, chat.id, 'b1').expect(201);

      const first = await http().patch(`/api/conversations/${chat.id}/read`).set(bearer(bob.token)).expect(200);
      expect(first.body.data.updatedCount).toBe(2);
      const second = await http().patch(`/api/conversations/${chat.id}/read`).set(bearer(bob.token)).expect(200);
      expect(second.body.data.updatedCount).toBe(0);

      const bobMessage = await prisma.message.findFirst({ where: { senderId: bob.id } });
      expect(bobMessage!.readAt).toBeNull(); // bob's own message is still unread for alice

      const bobList = await http().get('/api/conversations').set(bearer(bob.token)).expect(200);
      expect(bobList.body.data.items[0].unreadCount).toBe(0);
    });

    it('concurrent mark-as-read requests update each message once', async () => {
      const chat = await startChat(alice, bob);
      for (let i = 0; i < 5; i++) await send(alice, chat.id, `m${i}`).expect(201);
      const results = await Promise.all(
        Array.from({ length: 3 }, () => http().patch(`/api/conversations/${chat.id}/read`).set(bearer(bob.token))),
      );
      const total = results.reduce((sum, r) => sum + r.body.data.updatedCount, 0);
      expect(total).toBe(5);
    });

    it('PATCH /messages/:id/read: recipient ok and idempotent, sender 403, outsider 404', async () => {
      const chat = await startChat(alice, bob);
      const msg = (await send(alice, chat.id, 'hello').expect(201)).body.data;

      await http().patch(`/api/messages/${msg.id}/read`).set(bearer(alice.token)).expect(403);
      await http().patch(`/api/messages/${msg.id}/read`).set(bearer(eve.token)).expect(404);

      const read1 = await http().patch(`/api/messages/${msg.id}/read`).set(bearer(bob.token)).expect(200);
      const read2 = await http().patch(`/api/messages/${msg.id}/read`).set(bearer(bob.token)).expect(200);
      expect(read1.body.data.readAt).toBeTruthy();
      expect(read2.body.data.readAt).toBe(read1.body.data.readAt);

      await http().patch(`/api/messages/${randomUUID()}/read`).set(bearer(bob.token)).expect(404);
    });
  });

  describe('device tokens', () => {
    it('registers, moves a token to the new owner on re-login, and unregisters', async () => {
      await http().post('/api/devices').set(bearer(alice.token)).send({ token: 'tok-1', platform: 'IOS' }).expect(200);
      await http().post('/api/devices').set(bearer(alice.token)).send({ token: 'tok-1', platform: 'IOS' }).expect(200);
      expect(await prisma.deviceToken.count()).toBe(1);

      await http().post('/api/devices').set(bearer(bob.token)).send({ token: 'tok-1' }).expect(200);
      expect((await prisma.deviceToken.findUnique({ where: { token: 'tok-1' } }))!.userId).toBe(bob.id);

      // alice cannot remove bob's token
      await http().delete('/api/devices').set(bearer(alice.token)).send({ token: 'tok-1' }).expect(200);
      expect(await prisma.deviceToken.count()).toBe(1);
      await http().delete('/api/devices').set(bearer(bob.token)).send({ token: 'tok-1' }).expect(200);
      expect(await prisma.deviceToken.count()).toBe(0);

      await http().post('/api/devices').set(bearer(bob.token)).send({ platform: 'IOS' }).expect(400);
      await http().post('/api/devices').set(bearer(bob.token)).send({ token: 't', platform: 'NOKIA' }).expect(400);
    });
  });
});
