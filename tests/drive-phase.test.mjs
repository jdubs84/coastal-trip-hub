import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import DrivePhase from '../drive-phase.js';

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

test('last day checkout is 10:00 AM ET', () => {
  const leave = html.match(/"2026-10-13":\s*\{[^}]*leave:"([^"]+)"/);
  assert.ok(leave, 'Oct 13 plan');
  assert.equal(checkoutByMinutes(leave[1]), 10 * 60);
  assert.equal(checkoutPassed(leave[1], 9 * 60), false);
  assert.equal(checkoutPassed(leave[1], 9 * 60 + 59), false);
  assert.equal(checkoutPassed(leave[1], 10 * 60), true);
  assert.equal(checkoutPassed(leave[1], 21 * 60 + 10), true);
});
