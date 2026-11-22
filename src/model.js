import { createHash } from 'node:crypto';

export const TTL = 900;
export const CLOCK_SKEW_MS = 60000;
export const TOKEN = /^[^\s\x00-\x1f\x7f]{1,8192}(?![\s\S])/;
export const ROOM = /^[A-Z0-9]{12}$(?![\s\S])/;
export const isId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort(), wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const word = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$(?![\s\S])/.test(value);
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()
  && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && value.trim() === value;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function iso(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$(?![\s\S])/.test(raw)) throw new Error('Expected a UTC timestamp.');
  const time = Date.parse(raw);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== raw.slice(0, 19)) throw new Error('Invalid UTC timestamp.');
  return new Date(time).toISOString();
}



const safeId = value => word(value) && value.length <= 12 && !['constructor', 'prototype', '__proto__', 'unknown'].includes(value);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const POLICY = Object.freeze({ name: 'weighted-quorum-intersection-v1',
  family: 'all subsets whose positive integer replica weights sum to at least the declared threshold',
  minimal: 'qualifying subsets with no qualifying proper subset; every nonminimal quorum contains a minimal one',
  readWrite: 'every read quorum must intersect every write quorum',
  writeWrite: 'every write quorum must intersect every write quorum',
  unavailable: 'an empty family is unavailable; its intersection properties are null, never vacuously safe',
  selection: 'one owner identifies the documented deployed threshold profile; Unknown withholds the audit',
  excluded: 'read/read requirements, node failures, reconfiguration, Byzantine behavior, protocols, consensus, linearizability and live changes' });
export const POLICY_HASH = hash(POLICY);
const promptFor = input => `${input.title}\n${input.context}\nWhich documented threshold profile is deployed for ${input.auditId}?\n${input.profiles.map(p => `${p.label}: read ${p.readThreshold}, write ${p.writeThreshold}; ${p.reference}`).join('\n')}\nThresholds sum replica weights. Choose Unknown if unverified. Replica IDs and weights stay local.`;
export function validateInput(input) {
  if (!keys(input, ['auditId', 'title', 'context', 'replicas', 'profiles']) || !word(input.auditId)
    || !line(input.title, 40) || !line(input.context, 80) || !Array.isArray(input.replicas) || input.replicas.length < 1 || input.replicas.length > 10
    || !Array.isArray(input.profiles) || input.profiles.length < 1 || input.profiles.length > 3) throw new Error('Supply audit metadata, one to ten replicas and one to three documented threshold profiles.');
  const ids = new Set();
  const replicas = Array.from(input.replicas, replica => {
    if (!keys(replica, ['id', 'weight']) || !safeId(replica.id) || ids.has(replica.id) || !Number.isSafeInteger(replica.weight) || replica.weight < 1 || replica.weight > 1000000) throw new Error('Replicas need unique safe IDs and integer weights from 1 to 1000000.');
    ids.add(replica.id); return { ...replica };
  }).sort((a, b) => order(a.id, b.id));
  const profileIds = new Set(), labels = new Set(), thresholds = new Set();
  const profiles = Array.from(input.profiles, profile => {
    if (!keys(profile, ['id', 'label', 'reference', 'readThreshold', 'writeThreshold']) || !safeId(profile.id) || profileIds.has(profile.id)
      || !line(profile.label, 24) || labels.has(profile.label) || profile.label.toLowerCase() === 'unknown' || !line(profile.reference, 40)
      || !Number.isSafeInteger(profile.readThreshold) || profile.readThreshold < 1 || profile.readThreshold > 10000001
      || !Number.isSafeInteger(profile.writeThreshold) || profile.writeThreshold < 1 || profile.writeThreshold > 10000001) throw new Error('Profiles need unique IDs/labels, a reference and integer read/write thresholds from 1 to 10000001.');
    const pair = `${profile.readThreshold}/${profile.writeThreshold}`;
    if (thresholds.has(pair)) throw new Error('Profiles must declare distinct read/write threshold pairs.');
    profileIds.add(profile.id); labels.add(profile.label); thresholds.add(pair); return { ...profile };
  });
  const result = { auditId: input.auditId, title: input.title, context: input.context, replicas, profiles };
  if (promptFor(result).length > 500) throw new Error('Quorum-profile Question exceeds 500 UTF-16 units; shorten metadata or profile descriptions.');
  return result;
}
export function validateConfig(config) {
  if (!keys(config, ['participant']) || !keys(config.participant, ['id', 'label']) || !isId(config.participant.id) || !line(config.participant.label, 60)) throw new Error('Config requires an exact replication owner UUID and label.');
  return structuredClone(config);
}
export const itemsFor = input => { validateInput(input); return [{ id: 'profile' }]; };
export function requestFor(rawInput, config, itemId, attemptId) {
  const input = validateInput(rawInput); validateConfig(config);
  if (itemId !== 'profile' || !isId(attemptId)) throw new Error('Invalid quorum-profile selection or attempt.');
  const key = `quorum-${attemptId}`;
  return { prompt: promptFor(input), context: `To ${config.participant.id}`,
    options: [...input.profiles.map(profile => ({ value: profile.id, label: profile.label, style: 'default' })), { value: 'unknown', label: 'Unknown', style: 'default' }],
    responder_scope: 'direct', target_user_id: config.participant.id, ttl: TTL, correlation_id: key,
    data: { input_hash: hash(input), replicas_hash: hash(input.replicas), policy_hash: POLICY_HASH, item_id: itemId, attempt_id: attemptId }, idempotencyKey: key };
}
export function previewInput(rawInput, config) {
  const input = validateInput(rawInput), request = requestFor(input, config, 'profile', '01990000-0000-7000-8000-000000000001');
  const { correlation_id, idempotencyKey, data, ...question } = request;
  return { source: input, sourceHash: hash(input), policy: POLICY, policyHash: POLICY_HASH, question,
    note: 'The attempt UUID, correlation ID and input/replicas/policy hashes are added when the session creates its Question.' };
}

/** Pure finite-set audit. CLI export also requires an attributed declaration of the deployed profile. */
export function auditQuorums(rawInput, profileId) {
  const input = validateInput(rawInput), profile = input.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Select a declared threshold profile before auditing.');
  const { replicas } = input, limit = 1 << replicas.length;
  const sums = Array(limit).fill(0);
  for (let mask = 1; mask < limit; mask++) {
    const bit = mask & -mask, index = Math.log2(bit);
    sums[mask] = sums[mask ^ bit] + replicas[index].weight;
  }
  const describe = mask => ({ replicas: replicas.filter((_, index) => mask & (1 << index)).map(replica => replica.id), weight: sums[mask] });
  const enumerate = threshold => {
    const minimal = []; let qualifyingCount = 0;
    for (let mask = 1; mask < limit; mask++) {
      if (sums[mask] < threshold) continue;
      qualifyingCount++;
      if (replicas.every((replica, index) => !(mask & (1 << index)) || sums[mask] - replica.weight < threshold)) minimal.push(mask);
    }
    return { threshold, available: qualifyingCount > 0, qualifyingCount, masks: minimal, minimalQuorums: minimal.map(describe) };
  };
  const reads = enumerate(profile.readThreshold), writes = enumerate(profile.writeThreshold);
  const check = (left, right) => {
    if (!left.available || !right.available) return { intersects: null, reason: 'unavailable_family', disjointWitness: null };
    for (const a of left.masks) for (const b of right.masks) {
      if ((a & b) === 0) return { intersects: false, reason: 'disjoint_quorums', disjointWitness: { left: describe(a), right: describe(b) } };
    }
    return { intersects: true, reason: 'all_pairs_intersect', disjointWitness: null };
  };
  const readWrite = check(reads, writes), writeWrite = check(writes, writes);
  const family = ({ masks, ...details }) => details;
  return { profile, totalWeight: sums[limit - 1], subsetCount: limit, read: family(reads), write: family(writes), readWrite, writeWrite,
    verdict: !reads.available || !writes.available ? 'unavailable' : readWrite.intersects && writeWrite.intersects ? 'intersects' : 'disjoint',
    sourceHash: hash(input), policyHash: POLICY_HASH, configurationChanged: false,
    note: 'Intersection evidence for this fixed weighted-subset model only; it does not establish a replication protocol or consistency guarantee.' };
}
export function quorumPlan(rawInput, choice) {
  const input = validateInput(rawInput);
  if (choice !== null && choice !== 'unknown' && !input.profiles.some(profile => profile.id === choice)) throw new Error('Supply a declared profile, Unknown or a missing selection.');
  return { status: choice === null ? 'incomplete' : choice === 'unknown' ? 'unknown' : 'complete', analysis: choice === null || choice === 'unknown' ? null : auditQuorums(input, choice) };
}

export function validateState(state, rawInput) {
  const input = validateInput(rawInput);
  if (!keys(state, ['version', 'inputHash', 'config', 'room', 'credentialHash', 'startedAt', 'attempts']) || state.version !== 1
    || state.inputHash !== hash(input) || typeof state.room !== 'string' || !ROOM.test(state.room)
    || typeof state.credentialHash !== 'string' || !/^[0-9a-f]{64}$(?![\s\S])/.test(state.credentialHash)
    || !Array.isArray(state.attempts) || state.attempts.length > itemsFor(input).length || iso(state.startedAt) !== state.startedAt) throw new Error('Invalid state or changed quorum configuration. Restore the original input and configuration.');
  validateConfig(state.config);
  const items = itemsFor(input), ids = new Set(), questionIds = new Set(); let previous = state.startedAt, askerId;
  for (const [index, attempt] of state.attempts.entries()) {
    if (!keys(attempt, ['id', 'itemId', 'createdAt', 'request', 'questionId', 'status', 'observation']) || !isId(attempt.id) || ids.has(attempt.id)
      || attempt.itemId !== items[index].id || iso(attempt.createdAt) !== attempt.createdAt || attempt.createdAt < previous
      || hash(attempt.request) !== hash(requestFor(input, state.config, attempt.itemId, attempt.id))
      || !['creating', 'pending', 'answered', 'expired', 'cancelled', 'invalid_answer'].includes(attempt.status)) throw new Error('Invalid saved quorum-profile selection or order.');
    ids.add(attempt.id); previous = attempt.createdAt;
    if (attempt.status === 'creating') {
      if (attempt.questionId !== null || attempt.observation !== null) throw new Error('Invalid uncertain creation state.');
    } else {
      if (!isId(attempt.questionId) || questionIds.has(attempt.questionId)) throw new Error('Invalid or repeated Question ID.');
      questionIds.add(attempt.questionId); validateObservation(attempt.observation, attempt.status, attempt.request);
      if (attempt.observation.checkedAt < attempt.createdAt) throw new Error('Observation predates its saved creation intent.');
      previous = attempt.observation.checkedAt;
      if (Date.parse(attempt.observation.createdAt) < Date.parse(attempt.createdAt) - CLOCK_SKEW_MS) throw new Error('Question predates its saved creation intent.');
      if (askerId !== undefined && attempt.observation.askerId !== askerId) throw new Error('Questions belong to different asking registrations.');
      askerId = attempt.observation.askerId;
    }
    if (['creating', 'pending'].includes(attempt.status) && index !== state.attempts.length - 1) throw new Error('Only the last confirmation may have an active Question.');
  }
  return state;
}




export function report(state, rawInput) {
  const input = validateInput(rawInput); validateState(state, input);
  const attempt = state.attempts[0], answer = attempt?.observation?.answer;
  const answers = [{ itemId: 'profile', status: attempt?.status === 'creating' ? 'create_unknown' : attempt?.status ?? 'unasked',
    choice: answer?.value ?? null, label: answer?.label ?? null, questionId: attempt?.questionId ?? null, attemptId: attempt?.id ?? null,
    responderId: answer?.responderId ?? null, answeredAt: answer?.answeredAt ?? null, askerId: attempt?.observation?.askerId ?? null, observedAt: attempt?.observation?.checkedAt ?? null }];
  const calculation = quorumPlan(input, answers[0].choice);
  const status = ['create_unknown', 'pending'].includes(answers[0].status) ? answers[0].status : answers[0].status === 'unasked' ? 'ready' : calculation.status;
  return { version: 1, auditId: input.auditId, sourceHash: hash(input), source: input, policy: POLICY, policyHash: POLICY_HASH,
    participant: state.config.participant, room: state.room, configHash: hash(state.config), answers, ...calculation, status };
}

function validateObservation(observation, status, request) {
  if (!keys(observation, ['createdAt', 'expiresAt', 'checkedAt', 'askerId', 'resolvedAt', 'answer']) || !isId(observation.askerId)) throw new Error('Invalid saved observation.');
  for (const key of ['createdAt', 'expiresAt', 'checkedAt']) if (iso(observation[key]) !== observation[key]) throw new Error('Invalid saved timestamp.');
  const duration = Date.parse(observation.expiresAt) - Date.parse(observation.createdAt);
  if (duration < TTL * 1000 - 1000 || duration > TTL * 1000 + 1000) throw new Error('Question lifetime differs from the saved request.');
  const latest = Date.parse(observation.checkedAt) + CLOCK_SKEW_MS;
  if (Date.parse(observation.createdAt) > latest) throw new Error('Question creation is implausibly in the future. Check the local clock.');
  if (status === 'pending') {
    if (observation.resolvedAt !== null) throw new Error('Pending Question has a resolution timestamp.');
  } else if (iso(observation.resolvedAt) !== observation.resolvedAt || observation.resolvedAt < observation.createdAt
    || Date.parse(observation.resolvedAt) > latest
    || (status === 'expired' ? observation.resolvedAt < observation.expiresAt : observation.resolvedAt > observation.expiresAt)) throw new Error('Invalid Question resolution time.');
  if (status === 'answered') {
    const answer = observation.answer;
    if (!keys(answer, ['value', 'label', 'responderId', 'answeredAt']) || answer.responderId !== request.target_user_id
      || !request.options.some((option) => option.value === answer.value && option.label === answer.label)
      || iso(answer.answeredAt) !== answer.answeredAt || answer.answeredAt !== observation.resolvedAt
      || answer.answeredAt < observation.createdAt || answer.answeredAt > observation.expiresAt) throw new Error('Invalid saved quorum-profile selection evidence.');
  } else if (observation.answer !== null) throw new Error('Unanswered quorum-profile selections must not contain quorum-profile selection evidence.');
}

export function observeQuestion(q, request, questionId, room, checkedAt) {
  if (!isId(questionId) || q?.id !== questionId || q.kind !== 'question' || (q.is_handoff !== undefined && q.is_handoff !== false)
    || q.asker?.type !== 'agent' || !isId(q.asker?.id) || q.prompt !== request.prompt || q.context !== request.context
    || q.responder_scope !== 'direct' || q.target_user_id !== request.target_user_id || q.resolution_policy !== 'first'
    || (q.results !== undefined && q.results !== null) || q.text_input !== null || q.correlation_id !== request.correlation_id || q.reply_to !== null || hash(q.data) !== hash(request.data)
    || (q.room_code ?? q.room?.code) !== room || q.room_code !== undefined && q.room_code !== room
    || q.room !== undefined && q.room?.code !== room || !['pending', 'answered', 'expired', 'cancelled'].includes(q.state)
    || !Array.isArray(q.options) || q.options.length !== request.options.length
    || Array.from(q.options).some((option, index) => option?.value !== request.options[index].value || option?.label !== request.options[index].label
      || (option?.primary !== undefined && option.primary !== false) || (option?.destructive !== undefined && option.destructive !== false))) throw new Error('Question does not match the saved configuration, room, or reviewer.');
  const observation = { createdAt: iso(q.created_at), expiresAt: iso(q.expires_at), checkedAt: iso(checkedAt), askerId: q.asker.id,
    resolvedAt: q.resolved_at === null ? null : iso(q.resolved_at), answer: null };
  let status = q.state === 'answered' ? 'invalid_answer' : q.state;
  if (q.state !== 'answered' && q.answer !== null) throw new Error('Unresolved Question includes an unexpected answer.');
  if (q.state === 'answered') {
    const answer = q.answer;
    try {
      if (!answer || answer.text !== null || answer.responder?.id !== request.target_user_id
        || !request.options.some((option) => option.value === answer.value && option.label === answer.label)) throw new Error('Invalid answer.');
      observation.answer = { value: answer.value, label: answer.label, responderId: answer.responder.id, answeredAt: iso(answer.answered_at) };
      validateObservation(observation, 'answered', request); status = 'answered';
    } catch { observation.answer = null; }
  }
  validateObservation(observation, status, request);
  return { status, observation };
}

export function assertParticipantRoom(rooms, room, participantId) {
  if (!Array.isArray(rooms) || rooms.length > 1000) throw new Error('Invalid room inventory.');
  const matches = rooms.filter((item) => item?.invite_code === room), selected = matches[0];
  if (matches.length !== 1 || selected.type !== 'standard' || selected.is_public !== false || !Array.isArray(selected.members)
    || selected.members.length > 1000 || !selected.members.some((member) => member?.user_id === participantId)) throw new Error('Use a granted standard private room containing the named participant.');
}
