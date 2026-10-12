import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import DrivePhase from '../drive-phase.js';
import StayCard from '../stay-card.js';

const {
  leaveByMinutes,
  arrivalByMinutes,
  checkoutByMinutes,
  drivePhase,
  checkoutPassed
} = DrivePhase;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function card(date) {
  const block = html.match(new RegExp('data-drive-date="' + date + '"[\\s\\S]*?</article>'));
  assert.ok(block, 'drive card ' + date);
  const arrival = block[0].match(/data-arrival="([^"]*)"/);
  const leave = block[0].match(/Leave by ([^<]+)/);
  assert.ok(arrival && leave, 'leave and arrival on ' + date);
  return {
    arrival: arrival[1].replace(/&amp;/g, '&'),
    leave: leave[1].trim()
  };
}

test('published leave-by and arrival clocks', () => {
  const expect = {
    '2026-10-01': [12 * 60 + 30, 15 * 60],
    '2026-10-04': [11 * 60, 16 * 60],
    '2026-10-06': [13 * 60 + 55, 17 * 60],
    '2026-10-08': [10 * 60 + 35, 15 * 60],
    '2026-10-11': [12 * 60, 16 * 60]
  };
  Object.keys(expect).forEach((date) => {
    const c = card(date);
    assert.equal(leaveByMinutes(c.leave), expect[date][0], date + ' leave ' + c.leave);
    assert.equal(arrivalByMinutes(c.arrival), expect[date][1], date + ' arrival ' + c.arrival);
    assert.equal(drivePhase(c.leave, c.arrival, expect[date][0] - 1), 'before', date);
    assert.equal(drivePhase(c.leave, c.arrival, expect[date][0]), 'enroute', date);
    assert.equal(drivePhase(c.leave, c.arrival, expect[date][1] - 1), 'enroute', date);
    assert.equal(drivePhase(c.leave, c.arrival, expect[date][1]), 'arrived', date);
  });
});

test('Thu Oct 8 morning, the drive, and after arrival', () => {
  const c = card('2026-10-08');
  assert.equal(drivePhase(c.leave, c.arrival, 8 * 60), 'before');
  assert.equal(drivePhase(c.leave, c.arrival, 10 * 60 + 34), 'before');
  assert.equal(drivePhase(c.leave, c.arrival, 12 * 60), 'enroute');
  assert.equal(drivePhase(c.leave, c.arrival, 21 * 60 + 10), 'arrived');
});

test('Frisco stay names the cabin and campground', () => {
  assert.match(html, /"2026-10-09":[^}]*checkin:"Cabin 6 · Frisco Woods"/);
  assert.equal(html.includes('Cabin: 6'), false);
  assert.equal(html.includes('Still Frisco · Cabin 6'), false);
});

const STAYS = JSON.parse(html.match(/const STAYS = (\[[\s\S]*?\]);/)[1]);
const STAY_CALL = {
  anastasia: ['tel:+19049886869', 'Call 904-988-6869'],
  edisto: ['tel:+18438692156', 'Call 843-869-2156'],
  georgetown: ['tel:+17204087414', 'Call host 720-408-7414'],
  carolina: ['tel:+19104587770', 'Call marina 910-458-7770'],
  hammocks: ['tel:+19103264881', 'Call 910-326-4881'],
  frisco: ['tel:+12529955208', 'Call 252-995-5208']
};
const DAY_CALL = {
  '2026-09-29': STAY_CALL.edisto,
  '2026-10-01': STAY_CALL.georgetown,
  '2026-10-04': STAY_CALL.carolina,
  '2026-10-06': STAY_CALL.hammocks,
  '2026-10-08': STAY_CALL.frisco,
  '2026-10-11': STAY_CALL.frisco
};

test('stay cards name the place once and do not say Still', () => {
  assert.equal(/checkin:"Still /.test(html), false);
  assert.equal(/next:"Still /.test(html), false);
  assert.match(html, /"2026-10-12":[^}]*checkin:"Checkout Tue Oct 13 at 10:00 AM"/);
  assert.match(html, /"2026-10-10":[^}]*checkin:"Checkout noon Sun Oct 11"/);
  const corolla = STAYS.find((s) => s.id === 'corolla');
  const frisco = STAYS.find((s) => s.id === 'frisco');
  const carolina = STAYS.find((s) => s.id === 'carolina');
  const edisto = STAYS.find((s) => s.id === 'edisto');
  assert.equal(
    StayCard.stayDetailLine('Still Corolla GhettOHway Condo · checkout Tue Oct 13 at 10:00 AM', corolla, 'GhettOHway Condo · Corolla'),
    'Checkout Tue Oct 13 at 10:00 AM'
  );
  assert.equal(
    StayCard.stayDetailLine('Still Frisco · checkout noon Sun Oct 11', frisco, 'Cabin 6 · Frisco Woods'),
    'Checkout noon Sun Oct 11'
  );
  assert.equal(
    StayCard.stayDetailLine('Cabin 6 · Frisco Woods', frisco, 'Cabin 6 · Frisco Woods'),
    'Cabin 6 · Frisco Woods'
  );
  assert.equal(
    StayCard.stayDetailLine('Still Carolina Beach', carolina, 'Carolina Beach SP cabin'),
    ''
  );
  assert.equal(
    StayCard.stayDetailLine('Carolina Beach SP cabin', carolina, 'Carolina Beach SP cabin'),
    'Carolina Beach SP cabin'
  );
  assert.equal(
    StayCard.stayDetailLine('Edisto Cabin 2 · checkout Thu Oct 1 by 10:00 AM', edisto, 'Cabin 2 · Edisto Beach SP'),
    'Cabin 2 · checkout Thu Oct 1 by 10:00 AM'
  );
  assert.equal(
    StayCard.stayDetailLine('On island · checkout Sun by 10 AM', STAYS.find((s) => s.id === 'georgetown'), "Clayton Cabin · Commander's Island"),
    'On island · checkout Sun by 10 AM'
  );
});

function planLeave(date) {
  const m = html.match(new RegExp('"' + date + '":\\s*\\{[^}]*leave:"([^"]+)"'));
  assert.ok(m, 'plan leave ' + date);
  return m[1];
}

function changeoverSwitched(date, minutes) {
  const c = card(date);
  const phase = drivePhase(c.leave, c.arrival, minutes);
  const checkedOut = checkoutPassed(planLeave(date) + ' ' + c.leave, minutes);
  return phase === 'arrived' || checkedOut;
}

test('changeover dates call the new stay after arrival or morning checkout', () => {
  assert.match(html, /"2026-10-11": \["tel:\+12529955208", "Call 252-995-5208"\]/);
  const phone = (date, minutes) => StayCard.callForDay(date, STAYS, STAY_CALL, DAY_CALL, changeoverSwitched(date, minutes));
  assert.equal(phone('2026-10-11', 8 * 60)[1], 'Call 252-995-5208');
  assert.equal(phone('2026-10-11', 12 * 60), null);
  assert.equal(phone('2026-10-11', 16 * 60), null);
  assert.equal(phone('2026-10-11', 21 * 60) , null);
  assert.equal(phone('2026-10-08', 8 * 60)[1], 'Call 252-995-5208');
  assert.equal(phone('2026-10-08', 21 * 60)[1], 'Call 252-995-5208');
  assert.notEqual(phone('2026-10-08', 21 * 60)[0], STAY_CALL.hammocks[0]);
  assert.equal(phone('2026-10-06', 8 * 60)[1], 'Call 910-326-4881');
  assert.equal(phone('2026-10-06', 17 * 60)[1], 'Call 910-326-4881');
  assert.equal(phone('2026-10-04', 8 * 60)[1], 'Call marina 910-458-7770');
  assert.equal(phone('2026-10-04', 21 * 60)[1], 'Call marina 910-458-7770');
  assert.equal(phone('2026-10-01', 9 * 60)[1], 'Call host 720-408-7414');
  assert.equal(phone('2026-10-01', 16 * 60)[1], 'Call host 720-408-7414');
  const handoffs = STAYS.filter((stay) => STAYS.some((next) => next.start === stay.end && next.id !== stay.id));
  assert.ok(handoffs.length >= 6);
  handoffs.forEach((stay) => {
    const incoming = STAYS.find((next) => next.start === stay.end);
    const after = StayCard.callForDay(stay.end, STAYS, STAY_CALL, DAY_CALL, true);
    assert.equal(after, STAY_CALL[incoming.id] || null, stay.end + ' after the switch');
    if (after && STAY_CALL[stay.id]) assert.notEqual(after[0], STAY_CALL[stay.id][0], stay.id + ' phone must not survive the switch');
  });
});

test('last day checkout is 10:00 AM ET', () => {
  const leave = html.match(/"2026-10-13":\s*\{[^}]*leave:"([^"]+)"/);
  assert.ok(leave, 'Oct 13 plan');
  assert.equal(checkoutByMinutes(leave[1]), 10 * 60);
  assert.equal(checkoutPassed(leave[1], 9 * 60), false);
  assert.equal(checkoutPassed(leave[1], 9 * 60 + 59), false);
  assert.equal(checkoutPassed(leave[1], 10 * 60), true);
  assert.equal(checkoutPassed(leave[1], 21 * 60 + 10), true);
});
