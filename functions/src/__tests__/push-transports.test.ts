/**
 * The mobile channel's two transports (docs/mobile.md, "Notifications").
 *
 * The rule this file exists to protect: THE TRANSPORT IS A PROPERTY OF THE
 * ADDRESS, NOT OF THE NOTIFICATION. A participant may hold a desktop browser,
 * an installed web app and a store build at once; a caller asks for that
 * participant to be told something and never names a transport, and every
 * address is delivered over the one it was registered with.
 *
 * The second rule: an address is deleted only when the platform disowns it.
 * Deleting on a 500 or on a credential the server got wrong would unsubscribe
 * a working phone because the sender was misconfigured, and the participant
 * would never learn that their notifications had stopped.
 *
 * Real database, mocked platforms: web-push and FCM's HTTPS endpoint are the
 * two things a test cannot call, everything else runs for real.
 */

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('web-push');

import { generateKeyPairSync } from 'crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import webpush from 'web-push';
import { agents, pushSubscriptions } from '../db/schema';
import { fcmConfigured, sendPushToParticipant, webPushConfigured } from '../lib/push';
import { wrap } from '../lib/wrap';
import { notificationsRouter } from '../routes/notifications';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const PARTICIPANT = 'p-push';
const PAYLOAD = { title: 'A proposal needs you', body: 'Two markets closed', url: 'https://telarchy.com/w/acme' };

// A real throwaway keypair, so the JWT assertion is genuinely signed and the
// only mocked part of the FCM path is the network.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'telarchy-test',
  client_email: 'push@telarchy-test.iam.gserviceaccount.com',
  private_key: privateKey,
});

const sendNotification = webpush.sendNotification as jest.MockedFunction<typeof webpush.sendNotification>;

/** Every FCM call this test saw, in order, as { token, title }. */
let fcmSends: Array<{ token: string; title: string }> = [];
/** What the next FCM send answers with. */
let fcmReply: { status: number; body: unknown } = { status: 200, body: { name: 'projects/x/messages/1' } };

const realFetch = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  fcmSends = [];
  fcmReply = { status: 200, body: { name: 'projects/x/messages/1' } };
  process.env.VAPID_PUBLIC_KEY = 'test-public';
  process.env.VAPID_PRIVATE_KEY = 'test-private';
  process.env.FCM_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
  sendNotification.mockResolvedValue({} as never);

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
    }
    if (href.includes('fcm.googleapis.com')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      fcmSends.push({ token: body.message?.token, title: body.message?.notification?.title });
      return new Response(JSON.stringify(fcmReply.body), { status: fcmReply.status });
    }
    throw new Error(`unexpected fetch in test: ${href}`);
  }) as typeof fetch;

  await db.insert(agents).values({ id: PARTICIPANT, apiKeyHash: 'h-push', balance: 0, nickname: 'pusher' });
});

afterAll(() => {
  global.fetch = realFetch;
});

async function addBrowser(endpoint = 'https://fcm.example/browser-1') {
  await db.insert(pushSubscriptions).values({
    id: `web-${endpoint}`,
    agentId: PARTICIPANT,
    endpoint,
    keys: { p256dh: 'p', auth: 'a' },
    transport: 'webpush',
  });
}

async function addStoreBuild(token = 'device-token-1') {
  await db.insert(pushSubscriptions).values({
    id: `fcm-${token}`,
    agentId: PARTICIPANT,
    endpoint: token,
    keys: {},
    transport: 'fcm',
  });
}

const remaining = () => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.agentId, PARTICIPANT));

describe('the transport is a property of the address', () => {
  test('a row written before store builds existed is a browser', async () => {
    // The column has to default, or every subscription taken by the shipped
    // code becomes transport-less and undeliverable on the first deploy.
    await db.insert(pushSubscriptions).values({
      id: 'legacy',
      agentId: PARTICIPANT,
      endpoint: 'https://fcm.example/legacy',
      keys: { p256dh: 'p', auth: 'a' },
    });
    const [row] = await remaining();
    expect(row.transport).toBe('webpush');
  });

  test('a participant holding a browser and a store build is told over both', async () => {
    await addBrowser();
    await addStoreBuild();

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(fcmSends).toEqual([{ token: 'device-token-1', title: PAYLOAD.title }]);
  });

  test('every address of one kind is told, not just the first', async () => {
    await addStoreBuild('phone');
    await addStoreBuild('tablet');

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(fcmSends.map(s => s.token).sort()).toEqual(['phone', 'tablet']);
  });

  test('the caller names a participant and never a transport', async () => {
    await addStoreBuild();
    // The whole signature: who, and what to say.
    await expect(sendPushToParticipant(PARTICIPANT, PAYLOAD)).resolves.toBeUndefined();
    expect(sendPushToParticipant.length).toBe(2);
  });

  test('nobody else is told', async () => {
    await db.insert(agents).values({ id: 'other', apiKeyHash: 'h-other', balance: 0, nickname: 'other' });
    await db.insert(pushSubscriptions).values({
      id: 'others-phone',
      agentId: 'other',
      endpoint: 'someone-elses-token',
      keys: {},
      transport: 'fcm',
    });

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(fcmSends).toEqual([]);
  });

  test('a participant with no addresses is a no-op', async () => {
    await expect(sendPushToParticipant(PARTICIPANT, PAYLOAD)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(fcmSends).toEqual([]);
  });
});

describe('a transport with no credentials is skipped, never fatal', () => {
  test('an instance with no FCM credentials still reaches browsers', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '';
    await addBrowser();
    await addStoreBuild();

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(fcmSends).toEqual([]);
    // And the store build's address survives: it is fine, we are not.
    expect((await remaining()).length).toBe(2);
  });

  test('an instance with no VAPID keys still reaches store builds', async () => {
    process.env.VAPID_PUBLIC_KEY = '';
    process.env.VAPID_PRIVATE_KEY = '';
    await addBrowser();
    await addStoreBuild();

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(fcmSends.length).toBe(1);
  });

  test('an instance with neither sends nothing and throws nothing', async () => {
    process.env.VAPID_PUBLIC_KEY = '';
    process.env.VAPID_PRIVATE_KEY = '';
    process.env.FCM_SERVICE_ACCOUNT_JSON = '';
    await addBrowser();
    await addStoreBuild();

    await expect(sendPushToParticipant(PARTICIPANT, PAYLOAD)).resolves.toBeUndefined();
    expect((await remaining()).length).toBe(2);
  });

  test('a service account that is not JSON is unconfigured, not a crash', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = 'not json at all';
    expect(fcmConfigured()).toBe(false);
    expect(webPushConfigured()).toBe(true);
  });
});

describe('an address is deleted only when the platform disowns it', () => {
  test.each([404, 410])('a browser answering %i has revoked the subscription', async status => {
    await addBrowser();
    await addStoreBuild();
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: status }));

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    const left = await remaining();
    expect(left.map(r => r.transport)).toEqual(['fcm']);
  });

  test('a browser answering 500 keeps its subscription', async () => {
    await addBrowser();
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect((await remaining()).length).toBe(1);
  });

  test('FCM reporting UNREGISTERED deletes that device', async () => {
    await addBrowser();
    await addStoreBuild();
    fcmReply = {
      status: 404,
      body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
    };

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    const left = await remaining();
    expect(left.map(r => r.transport)).toEqual(['webpush']);
  });

  test('FCM failing with a server error keeps the device', async () => {
    await addStoreBuild();
    fcmReply = { status: 500, body: { error: { status: 'INTERNAL' } } };

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect((await remaining()).length).toBe(1);
  });

  test('FCM refusing our credentials keeps every device', async () => {
    // A 403 is the server being wrong, not the phone. Deleting here would
    // silently unsubscribe every store build the moment a key expired.
    await addStoreBuild('phone');
    await addStoreBuild('tablet');
    fcmReply = { status: 403, body: { error: { status: 'PERMISSION_DENIED' } } };

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect((await remaining()).length).toBe(2);
  });

  test('one dead address does not stop the ones behind it', async () => {
    await addStoreBuild('dead');
    await addBrowser();
    fcmReply = {
      status: 404,
      body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
    };

    await sendPushToParticipant(PARTICIPANT, PAYLOAD);

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe('the handshake and registering an address', () => {
  let caller: { agentId?: string } = { agentId: PARTICIPANT };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: { agentId?: string; scopes: string[] } }).auth = {
      ...caller,
      scopes: ['account:read', 'account:write'],
    };
    next();
  });
  app.use('/api/notifications', notificationsRouter);
  void wrap;

  beforeEach(() => {
    caller = { agentId: PARTICIPANT };
  });

  test('push-key reports each transport separately', async () => {
    const res = await request(app).get('/api/notifications/push-key');
    expect(res.status).toBe(200);
    // A store build needs to know FCM is live even where VAPID is not, and a
    // browser the reverse; one boolean cannot answer both clients.
    expect(res.body.transports).toEqual({ webpush: true, fcm: true });
    expect(res.body.publicKey).toBe('test-public');
  });

  test('push-key tells the truth when a transport is dark', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '';
    const res = await request(app).get('/api/notifications/push-key');
    expect(res.body.transports).toEqual({ webpush: true, fcm: false });
  });

  test('a store build registers its device token', async () => {
    const res = await request(app)
      .post('/api/notifications/push-subscriptions')
      .send({ transport: 'fcm', token: 'device-abc' });

    expect(res.status).toBe(200);
    const [row] = await remaining();
    expect(row.transport).toBe('fcm');
    expect(row.endpoint).toBe('device-abc');
  });

  test('a browser still registers the way it always did', async () => {
    const res = await request(app)
      .post('/api/notifications/push-subscriptions')
      .send({ subscription: { endpoint: 'https://fcm.example/b', keys: { p256dh: 'p', auth: 'a' } } });

    expect(res.status).toBe(200);
    const [row] = await remaining();
    expect(row.transport).toBe('webpush');
  });

  test('re-registering the same device does not duplicate deliveries', async () => {
    const send = () =>
      request(app).post('/api/notifications/push-subscriptions').send({ transport: 'fcm', token: 'device-abc' });
    await send();
    await send();

    expect((await remaining()).length).toBe(1);
  });

  test('a transport nobody implements is refused', async () => {
    const res = await request(app)
      .post('/api/notifications/push-subscriptions')
      .send({ transport: 'carrier-pigeon', token: 'x' });

    expect(res.status).toBe(400);
    expect((await remaining()).length).toBe(0);
  });

  test('a store build without a token is refused', async () => {
    const res = await request(app).post('/api/notifications/push-subscriptions').send({ transport: 'fcm' });
    expect(res.status).toBe(400);
  });

  test('registering an fcm address is refused where FCM is not configured', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '';
    const res = await request(app)
      .post('/api/notifications/push-subscriptions')
      .send({ transport: 'fcm', token: 'device-abc' });

    // 503 rather than 200: a client that stored a token nobody can send to
    // would show the user a working switch that delivers nothing.
    expect(res.status).toBe(503);
  });

  test('an anonymous caller registers nothing', async () => {
    caller = {};
    const res = await request(app)
      .post('/api/notifications/push-subscriptions')
      .send({ transport: 'fcm', token: 'device-abc' });

    expect(res.status).toBe(403);
    expect((await remaining()).length).toBe(0);
  });
});
