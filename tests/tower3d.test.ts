import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load the browser globals the way the page does: tower-model.js then tower3d.js, no DOM (tower3d.js exits before any DOM code).
const context: any = {};
vm.runInNewContext(readFileSync(new URL('../web/tower-model.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(readFileSync(new URL('../web/tower3d.js', import.meta.url), 'utf8'), context);
const T = context.DeskTower, D = context.DeskTower3D;
const now = Date.parse('2026-10-30T12:00:00Z');
const ids = Object.keys(T.ROSTER);
const floorIds = (s: any) => Array.from(s.floors, (f: any) => f.id as string);
const staffWith = (pick: (id: string, i: number) => string) => Object.fromEntries(ids.map((id, i) => [id, { state: pick(id, i) }]));

test('every roster seat appears exactly once, on its own department floor', () => {
  for (const staff of [T.build({}, now).staff, {}, staffWith((_, i) => T.STATES[i % T.STATES.length])]) {
    const s = D.scene(staff, T.ROSTER, T.FLOORS);
    const seen = s.floors.flatMap((f: any) => f.seats.map((x: any) => x.id));
    assert.equal(seen.length, ids.length); assert.equal(s.seats, ids.length);
    assert.deepEqual([...seen].sort(), [...ids].sort());
    for (const f of s.floors) for (const x of f.seats) assert.equal(x.dept, T.ROSTER[x.id][3]);
    for (const f of s.floors) assert.equal(Object.values(f.counts).reduce((a: number, b: any) => a + b, 0), f.seats.length);
  }
});

test('only RUNNING seats animate; BLOCKED, ERROR, UNKNOWN and the rest never do', () => {
  for (const state of T.STATES) {
    const s = D.scene(staffWith(() => state), T.ROSTER, T.FLOORS);
    for (const f of s.floors) for (const x of f.seats) { assert.equal(x.state, state); assert.equal(x.animated, state === 'RUNNING', `${x.id} ${state}`); }
  }
  // missing staff, a missing state or a state outside the vocabulary is UNKNOWN and still
  const odd: any = { pm: { state: 'working' }, cro: {}, exec: null };
  const s = D.scene(odd, T.ROSTER, T.FLOORS), seat = (id: string) => s.floors.flatMap((f: any) => f.seats).find((x: any) => x.id === id);
  for (const id of ['pm', 'cro', 'exec', 'feed']) { assert.equal(seat(id).state, 'UNKNOWN'); assert.equal(seat(id).animated, false); }
  // the real model: every animated seat is RUNNING
  const real = D.scene(T.build({}, now).staff, T.ROSTER, T.FLOORS);
  for (const f of real.floors) for (const x of f.seats) if (x.animated) assert.equal(x.state, 'RUNNING');
});

test('departments map to floors deterministically: leadership on top, data on the ground floor', () => {
  const a = D.scene({}, T.ROSTER, T.FLOORS), b = D.scene(staffWith(() => 'RUNNING'), T.ROSTER, T.FLOORS);
  const order = floorIds(a);
  assert.deepEqual(order, floorIds(b));
  assert.deepEqual(order, ['portfolio', 'risk', 'execution', 'desks', 'research', 'intel', 'ops', 'data']);
  assert.deepEqual(Array.from(a.floors, (f: any) => f.level), [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(a.floors[0].name, 'Portfolio management'); assert.equal(a.floors.at(-1).name, 'Data infrastructure');
  // roster key order does not change the result; an unknown department gets its own floor above ops and data
  const shuffled = Object.fromEntries([...Object.entries(T.ROSTER)].reverse());
  assert.deepEqual(floorIds(D.scene({}, shuffled, T.FLOORS)), order);
  const extra = { ...T.ROSTER, temp: ['Tim', 'Temp', 'RULES', 'archive'] };
  assert.deepEqual(floorIds(D.scene({}, extra, T.FLOORS)).slice(-3), ['archive', 'ops', 'data']);
});

test('page loads tower3d after tower.js and the stylesheet after tower.css', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="./tower.js"') < html.indexOf('src="./tower3d.js"'));
  assert.ok(html.indexOf('src="./tower3d.js"') < html.indexOf('src="./app.js"'));
  assert.ok(html.indexOf('href="./tower.css"') < html.indexOf('href="./tower3d.css"'));
});
