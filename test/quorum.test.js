import test from 'node:test';
import assert from 'node:assert/strict';
import { auditQuorums, quorumPlan, validateInput, requestFor, previewInput, hash } from '../src/model.js';
import { CONFIG, id } from '../src/mock.js';

const inputFor = (weights = [2, 2, 2], readThreshold = 3, writeThreshold = 3) => ({ auditId: 'replica-audit', title: 'Replication profile', context: 'Owner uses the deployment record.',
  replicas: weights.map((weight, index) => ({ id: `r${index}`, weight })),
  profiles: [{ id: 'deployed', label: 'Deployed profile', reference: 'Deployment record', readThreshold, writeThreshold }] });
const audit = (weights, r, w) => auditQuorums(inputFor(weights, r, w), 'deployed');
const key = members => [...members].sort().join('/');
function oracle(weights, readThreshold, writeThreshold) {
  let subsets = [[]];
  for (let index = 0; index < weights.length; index++) subsets = [...subsets, ...subsets.map(set => [...set, index])];
  const weight = set => set.reduce((sum, index) => sum + weights[index], 0);
  const reads = subsets.filter(set => weight(set) >= readThreshold), writes = subsets.filter(set => weight(set) >= writeThreshold);
  const minimal = family => family.filter(set => !family.some(other => other.length < set.length && other.every(index => set.includes(index))));
  const intersects = (left, right) => left.length === 0 || right.length === 0 ? null : left.every(a => right.every(b => a.some(index => b.includes(index))));
  return { reads, writes, readMinimal: minimal(reads), writeMinimal: minimal(writes), readWrite: intersects(reads, writes), writeWrite: intersects(writes, writes) };
}
function confirmWitness(property, weights, leftThreshold, rightThreshold) {
  if (property.intersects !== false) { assert.equal(property.disjointWitness, null); return; }
  const { left, right } = property.disjointWitness;
  assert.ok(left.replicas.every(replica => !right.replicas.includes(replica)));
  for (const [set, threshold] of [[left, leftThreshold], [right, rightThreshold]]) {
    assert.ok(set.weight >= threshold); assert.equal(set.weight, set.replicas.reduce((sum, replica) => sum + weights[Number(replica.slice(1))], 0));
  }
}

test('weighted granularity can prove overlap when threshold-sum inequalities cannot', () => {
  const result = audit([2, 2, 2], 3, 3);
  assert.equal(result.totalWeight, 6); assert.equal(result.verdict, 'intersects');
  assert.equal(result.read.qualifyingCount, 4); assert.equal(result.read.minimalQuorums.length, 3);
  assert.equal(result.readWrite.intersects, true); assert.equal(result.writeWrite.intersects, true);
  assert.deepEqual(result.read.minimalQuorums.map(q => q.replicas), [['r0', 'r1'], ['r0', 'r2'], ['r1', 'r2']]);
});
test('low thresholds expose deterministic disjoint read/write and write/write witnesses', () => {
  const result = audit([1, 1, 1], 1, 1); assert.equal(result.verdict, 'disjoint');
  assert.deepEqual(result.readWrite.disjointWitness, { left: { replicas: ['r0'], weight: 1 }, right: { replicas: ['r1'], weight: 1 } });
  assert.deepEqual(result.writeWrite.disjointWitness, result.readWrite.disjointWitness);
});
test('read/write and write/write are independent requirements', () => {
  const readStrong = audit([1, 1, 1], 3, 1);
  assert.equal(readStrong.readWrite.intersects, true); assert.equal(readStrong.writeWrite.intersects, false);
  const writeStrong = audit([1, 1, 1], 1, 2);
  assert.equal(writeStrong.readWrite.intersects, false); assert.equal(writeStrong.writeWrite.intersects, true);
});
test('disjoint reads are permitted when both audited properties hold', () => {
  const result = audit([1, 1, 1], 1, 3);
  assert.equal(result.verdict, 'intersects'); assert.equal(result.read.minimalQuorums.length, 3);
  assert.deepEqual(result.write.minimalQuorums, [{ replicas: ['r0', 'r1', 'r2'], weight: 3 }]);
});
test('unavailable families have null relevant intersection results, never vacuous success', () => {
  const writeMissing = audit([1, 1], 1, 3);
  assert.equal(writeMissing.verdict, 'unavailable'); assert.equal(writeMissing.readWrite.intersects, null); assert.equal(writeMissing.writeWrite.intersects, null);
  assert.equal(writeMissing.write.qualifyingCount, 0); assert.deepEqual(writeMissing.write.minimalQuorums, []);
  const readMissing = audit([1, 1], 3, 2);
  assert.equal(readMissing.verdict, 'unavailable'); assert.equal(readMissing.readWrite.intersects, null); assert.equal(readMissing.writeWrite.intersects, true);
  const bothMissing = audit([1], 2, 2); assert.equal(bothMissing.read.available, false); assert.equal(bothMissing.write.available, false);
});
test('single replica and heterogeneous weights keep exact qualifying sums', () => {
  const single = audit([1000000], 1000000, 1000000); assert.equal(single.verdict, 'intersects'); assert.equal(single.subsetCount, 2);
  const weighted = audit([5, 1, 1], 5, 3); assert.equal(weighted.verdict, 'intersects');
  assert.deepEqual(weighted.read.minimalQuorums, [{ replicas: ['r0'], weight: 5 }]);
});
test('all small integer-weight profiles agree with independent full-set pair oracle', () => {
  let cases = 0;
  for (let length = 1; length <= 4; length++) {
    for (let code = 0; code < 3 ** length; code++) {
      let digits = code; const weights = Array.from({ length }, () => { const value = digits % 3 + 1; digits = Math.floor(digits / 3); return value; });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      for (let r = 1; r <= total + 1; r++) for (let w = 1; w <= total + 1; w++) {
        const expected = oracle(weights, r, w), actual = audit(weights, r, w); cases++;
        assert.equal(actual.read.qualifyingCount, expected.reads.length); assert.equal(actual.write.qualifyingCount, expected.writes.length);
        assert.equal(actual.readWrite.intersects, expected.readWrite); assert.equal(actual.writeWrite.intersects, expected.writeWrite);
        assert.deepEqual(actual.read.minimalQuorums.map(q => key(q.replicas)).sort(), expected.readMinimal.map(set => key(set.map(i => `r${i}`))).sort());
        assert.deepEqual(actual.write.minimalQuorums.map(q => key(q.replicas)).sort(), expected.writeMinimal.map(set => key(set.map(i => `r${i}`))).sort());
        confirmWitness(actual.readWrite, weights, r, w); confirmWitness(actual.writeWrite, weights, w, w);
      }
    }
  }
  assert.equal(cases, 8420);
});
test('maximum replica count and weights stay exact with bounded output', () => {
  const result = audit(Array(10).fill(1000000), 5000000, 6000000);
  assert.equal(result.totalWeight, 10000000); assert.equal(result.subsetCount, 1024);
  assert.equal(result.read.minimalQuorums.length, 252); assert.equal(result.write.minimalQuorums.length, 210);
  assert.equal(result.readWrite.intersects, true); assert.equal(result.writeWrite.intersects, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
  assert.equal(audit(Array(10).fill(1), 5, 5).readWrite.intersects, false);
});
test('source is immutable, replica order canonical, profile order preserved and hashes bound', () => {
  const input = inputFor(), original = structuredClone(input), result = auditQuorums(input, 'deployed');
  assert.deepEqual(input, original); assert.equal(result.sourceHash, hash(validateInput(input)));
  input.replicas.reverse(); assert.deepEqual(auditQuorums(input, 'deployed'), result);
  input.replicas[0].weight++; assert.notEqual(auditQuorums(input, 'deployed').sourceHash, result.sourceHash);
});
test('malformed replicas, thresholds, metadata and duplicate profiles are refused', () => {
  for (const mutate of [
    x => { x.replicas = []; }, x => { x.replicas = Array(11).fill({ id: 'r0', weight: 1 }); },
    x => { x.replicas[1].id = 'r0'; }, x => { x.replicas[0].id = 'unknown'; },
    x => { x.replicas[0].weight = 0; }, x => { x.replicas[0].weight = 1.5; }, x => { x.replicas[0].weight = 1000001; },
    x => { delete x.replicas[0]; }, x => { x.profiles = []; }, x => { delete x.profiles[0]; },
    x => { x.profiles[0].readThreshold = 0; }, x => { x.profiles[0].writeThreshold = 10000002; }, x => { x.profiles[0].writeThreshold = NaN; },
    x => { x.profiles.push({ ...x.profiles[0], id: 'other', label: 'Other' }); },
    x => { x.profiles[0].label = 'Unknown'; }, x => { x.profiles[0].reference = '\ud800'; },
    x => { x.title = ' leading'; }, x => { x.context = 'line\nnew'; }, x => { x.replicas[0].extra = true; }, x => { x.auditId += '\n'; },
  ]) { const input = inputFor(); mutate(input); assert.throws(() => validateInput(input)); }
});
test('visible owner Question includes thresholds and references while values stay local', () => {
  const input = inputFor(), question = requestFor(input, CONFIG, 'profile', id(1));
  assert.match(question.prompt, /read 3, write 3; Deployment record/); assert.ok(!question.prompt.includes('r0'));
  assert.equal(question.target_user_id, CONFIG.participant.id); assert.equal(question.options.at(-1).value, 'unknown');
  assert.equal(question.data.replicas_hash, hash(validateInput(input).replicas));
  assert.deepEqual(previewInput(input, CONFIG).source, validateInput(input));
  assert.throws(() => requestFor(input, CONFIG, 'policy', id(1)));
  const large = inputFor(); large.title = 'a'.repeat(40); large.context = 'b'.repeat(80);
  large.profiles = [1, 2, 3].map(n => ({ id: `p${n}`, label: String(n).repeat(24), reference: 'x'.repeat(40), readThreshold: 10000001 - n, writeThreshold: 10000001 }));
  assert.throws(() => validateInput(large), /500/);
});
test('Unknown and missing declarations withhold analysis; unavailable or disjoint audits remain valid diagnostics', () => {
  const input = inputFor(); assert.equal(quorumPlan(input, null).analysis, null); assert.equal(quorumPlan(input, 'unknown').status, 'unknown');
  assert.equal(quorumPlan(input, 'deployed').status, 'complete'); assert.throws(() => quorumPlan(input, 'missing')); assert.throws(() => auditQuorums(input, 'unknown'));
});
