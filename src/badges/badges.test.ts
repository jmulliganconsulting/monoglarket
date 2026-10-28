import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleColour, schoolBadges, seniorityBadge, seniorityColour, seniorityLabel, standingLabel, statusBadges } from './badges.ts';

test('seniority colour: alum first, then the year; none without either', () => {
  assert.equal(seniorityColour({ studentStatus: 'alum', seniority: 'fifth' }), '#2a9859');
  assert.equal(seniorityColour({ studentStatus: 'current', seniority: 'phd' }), '#ddf8d2');
  assert.equal(seniorityColour({ studentStatus: 'none', seniority: null }), undefined);
});

test('seniority badge: Alum, Faculty, or the year in its colour; none without any', () => {
  assert.equal(seniorityBadge({ studentStatus: 'alum', seniority: null })?.label, 'Alum');
  assert.equal(seniorityBadge({ studentStatus: 'faculty', seniority: null })?.label, 'Faculty');
  assert.deepEqual(seniorityBadge({ studentStatus: 'current', seniority: 'third' }), { label: 'Third year', group: 'school', colour: '#68d147', icon: 'stairs' });
  assert.equal(seniorityBadge({ studentStatus: 'none', seniority: null }), null);
  assert.equal(seniorityBadge({ studentStatus: 'current', seniority: 'masters' })?.ring, '#68d147');
});

test('co-op shows in place of the year, for current students only', () => {
  assert.equal(seniorityBadge({ studentStatus: 'current', seniority: 'third', onCoopTerm: true })?.label, 'On co-op');
  assert.equal(seniorityColour({ studentStatus: 'current', seniority: 'third', onCoopTerm: true }), '#1abc9c');
  assert.equal(standingLabel({ studentStatus: 'current', seniority: 'third', onCoopTerm: true }), 'On co-op');
  assert.equal(standingLabel({ studentStatus: 'current', seniority: 'third', onCoopTerm: false }), 'Third year');
});

test('SE Staff ranks above Primary officer and sets the colour', () => {
  const badges = statusBadges({ role: 'creator', primaryOfficerSince: new Date() }, { status: 'se_staff', isMentor: false, isMember: false });
  assert.deepEqual(badges.map((b) => b.label), ['SE Staff', 'Primary officer']);
  assert.equal(roleColour(badges), '#908aec');
});

test('site roles and club records stack; a guest gets no badges', () => {
  assert.deepEqual(statusBadges({ role: 'creator' }, null), []);
  const labels = statusBadges({ role: 'admin' }, { status: 'officer', isMentor: true, isMember: true }).map((b) => b.label);
  assert.deepEqual(labels, ['Site administrator', 'Officer', 'Mentor', 'Member']);
  assert.deepEqual(statusBadges({ role: 'creator' }, { status: 'se_staff', isMentor: false, isMember: false }).map((b) => b.label), ['SE Staff']);
  assert.deepEqual(statusBadges({ role: 'moderator' }, { status: 'member', isMentor: false, isMember: false }).map((b) => b.label), ['Site moderator']);
});

test('the name colour follows the highest coloured role', () => {
  assert.equal(roleColour(statusBadges({ role: 'admin' }, { status: 'officer', isMentor: true, isMember: true })), '#8daecb');
  assert.equal(roleColour(statusBadges({ role: 'creator' }, { status: 'officer', isMentor: true, isMember: true })), '#e91e63');
  assert.equal(roleColour(statusBadges({ role: 'creator' }, { status: 'member', isMentor: false, isMember: true })), undefined);
  assert.equal(roleColour([]), undefined);
});

test('membership count goes on the Member label; seniority is text, not a badge', () => {
  const member = { status: 'member', isMentor: false, isMember: true, membershipCount: 12 };
  assert.deepEqual(statusBadges({ role: 'creator' }, member).map((b) => b.label), ['Member × 12']);
  assert.equal(seniorityLabel('third'), 'Third year');
  assert.equal(seniorityLabel(null), null);
});

test('school badges: current student, transfer, then each major', () => {
  const labels = schoolBadges({ studentStatus: 'current', isTransfer: true }, [{ program: 'Software Engineering', degree: 'BS' }]).map((b) => b.label);
  assert.deepEqual(labels, ['Current student', 'Transfer student', 'Software Engineering · BS']);
  assert.deepEqual(schoolBadges({ studentStatus: 'alum', isTransfer: false }, []), []);
});

test('primary officers get the gold badge above the other official roles', () => {
  const badges = statusBadges({ role: 'creator', primaryOfficerSince: new Date() }, { status: 'officer', isMentor: false, isMember: true });
  assert.deepEqual(badges.map((b) => b.label), ['Primary officer', 'Officer', 'Member']);
  assert.equal(roleColour(badges), '#f1c40f');
  assert.deepEqual(statusBadges({ role: 'creator', primaryOfficerSince: null }, null), []);
});
