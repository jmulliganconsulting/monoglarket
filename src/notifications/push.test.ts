// Web push alerts (FR-20): recent alerts go to members who turned them on, on each device; gone devices are forgotten.
// A fake sender stands in for the push service, so these run offline.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { sendPendingPushes, subscribeDevice, unsubscribeDevice, type Device } from './push.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let on: number, off: number, gone: number;
const device = (n: string): Device => ({ endpoint: `https://push.example.test/${n}`, p256dh: `p-${n}`, auth: `a-${n}` });

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  on = (await pool.user.create({ data: { displayName: 'On', role: 'member', pushAlerts: true, onboardedAt: new Date() } })).id;
  off = (await pool.user.create({ data: { displayName: 'Off', role: 'member', onboardedAt: new Date() } })).id;
  gone = (await pool.user.create({ data: { displayName: 'Gone', role: 'member', pushAlerts: true, onboardedAt: new Date() } })).id;
  await pool.pushSubscription.create({ data: { userId: on, ...device('on') } });
  await pool.pushSubscription.create({ data: { userId: off, ...device('off') } });
  await pool.pushSubscription.create({ data: { userId: gone, ...device('gone') } });
});
after(() => drop());

test('recent alerts reach members who turned them on, on their device; others are marked handled and not sent', async () => {
  for (const userId of [on, off, gone]) await pool.notification.create({ data: { userId, kind: 'resolved', text: `Snow resolved for ${userId}`, marketId: null } });
  const sent: { endpoint: string; payload: string }[] = [];
  const send = async (d: Device, payload: string) => {
    if (d.endpoint.endsWith('/gone')) {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    }
    sent.push({ endpoint: d.endpoint, payload });
  };
  const result = await sendPendingPushes(pool, send);
  assert.equal(result.sent, 1);
  assert.equal(result.pruned, 1);
  assert.deepEqual(sent.map((s) => s.endpoint), [device('on').endpoint]);
  assert.match(sent[0].payload, /Snow resolved for/);
  assert.equal(await pool.notification.count({ where: { userId: off, pushedAt: null } }), 0);
  assert.equal(await pool.pushSubscription.count({ where: { endpoint: device('gone').endpoint } }), 0);
});

test('an alert older than ten minutes is not sent when alerts are turned on later', async () => {
  const old = await pool.notification.create({ data: { userId: on, kind: 'closing', text: 'Old news', createdAt: new Date(Date.now() - 3_600_000) } });
  const sent: string[] = [];
  await sendPendingPushes(pool, async (d) => void sent.push(d.endpoint));
  assert.deepEqual(sent, []);
  assert.equal((await pool.notification.findUniqueOrThrow({ where: { id: old.id } })).pushedAt, null);
});

test('turning alerts on for a device, then off again, keeps the member flag in step with their devices', async () => {
  const id = (await pool.user.create({ data: { displayName: 'Toggle', role: 'member', onboardedAt: new Date() } })).id;
  await subscribeDevice(pool, id, { ...device('t1'), userAgent: 'test' });
  assert.equal((await pool.user.findUniqueOrThrow({ where: { id } })).pushAlerts, true);
  await subscribeDevice(pool, id, { ...device('t2') });
  await unsubscribeDevice(pool, id, device('t1').endpoint);
  assert.equal((await pool.user.findUniqueOrThrow({ where: { id } })).pushAlerts, true, 'one device is still on');
  await unsubscribeDevice(pool, id, device('t2').endpoint);
  assert.equal((await pool.user.findUniqueOrThrow({ where: { id } })).pushAlerts, false, 'the last device turned it off');
  const actions = (await pool.auditEntry.findMany({ where: { actorId: id }, orderBy: { id: 'asc' }, select: { action: true } })).map((a) => a.action);
  assert.deepEqual(actions, ['push_on', 'push_on', 'push_off', 'push_off']);
});
