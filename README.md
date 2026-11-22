# Weighted quorum audit with PingRoom

Audit a frozen replication configuration after its owner identifies the deployed threshold profile. Code enumerates minimal read and write quorums, then proves their intersection properties or returns disjoint witnesses. A threshold above total replica weight produces an unavailable-family result.

Use this after exporting replica weights and candidate deployment profiles. The starter writes local JSON only; it never contacts replicas or changes replication settings.

## Try it offline

Choose **Use this template**, clone your copy, and use Node.js 22 or newer:

```sh
npm ci
npm test
npm run demo
```

The fictional catalog demo covers overlapping quorums, disjoint quorums, an unavailable write family and Unknown. Tests and demos use published `@pingroom/sdk` 0.8.0 through local mock transports. After installation they need no credentials or network and send no live pings. Dependencies are pinned in the lockfile; `.npmrc` requests a 14-day release age where supported by npm.

## Prepare the configuration

```sh
cp examples/quorum.json quorum.json
cp config.example.json config.json
npm run preview
```

Map your retained export into `quorum.json`:

| Field | Contract |
| --- | --- |
| `auditId` | 1–40 characters: lowercase letter first, then lowercase letters, digits, `_` or `-`. |
| `title`, `context` | Nonempty, already-trimmed single-line descriptions, at most 40 and 80 UTF-16 code units. |
| `replicas` | 1–10 `{id, weight}` entries. IDs are unique; each weight is an integer from 1 to 1,000,000. |
| `profiles` | 1–3 `{id, label, reference, readThreshold, writeThreshold}` entries identifying documented deployment choices. |
| Replica/profile `id` | At most 12 characters using the `auditId` alphabet. `unknown`, `constructor`, `prototype` and `__proto__` are reserved. |
| Profile `label`, `reference` | Already-trimmed single lines of at most 24 and 40 UTF-16 code units. Labels must be unique and cannot be `Unknown`, ignoring case. |
| Thresholds | Positive integers up to 10,000,001. A threshold exceeding total weight represents an unavailable family. |

Profile IDs and read/write threshold pairs must be unique. The entire Question must fit 500 UTF-16 units; preview checks this before a request. Shorten metadata or descriptions if necessary. The input file must fit 64 KiB. Extra fields, sparse arrays, malformed Unicode, control/format characters and noninteger weights or thresholds are rejected.

Replicas are sorted by ID; profile order stays as supplied. Verify the export's membership and weights independently. This model assumes a quorum is **any subset whose total weight meets its threshold**. Systems with extra placement, topology or membership rules need a different model.

## Connect and identify the deployed profile

Install [PingRoom](https://pingroom.io/i), then:

```sh
npm run connect
npm run inspect
```

Approve pairing and grant a standard private room containing the replication owner, with room-list and Question create/read permissions. Verify the person in the app and enter their exact member UUID and a descriptive label in `config.json`. Names alone do not establish identity.

For an existing granted connection, copy `.env.example` to `.env` and set **both** `PINGROOM_TOKEN` and `PINGROOM_ROOM`. Blank or partial pairs are rejected; credential sources cannot be mixed.

```sh
npm run preview
npm start
# After the owner answers:
npm start
npm run export
```

Each run creates at most one direct, 15-minute Question or reads the original Question once. The owner chooses the documented deployed profile or **Unknown**. The Question includes each label, read/write threshold and reference; it asks for the installed profile, not an approval of its safety.

PingRoom receives the audit ID, title/context, profile labels/references/thresholds, owner UUID and input/replicas/policy hashes. Replica IDs and weights stay local. Missing, Unknown, expired, cancelled, invalid or misattributed answers block export. There is no background polling or replacement Question.

## Read the audit

```sh
npm run status
npm run report
npm run export
```

These commands are local and need no credentials. `report` writes `.quorum/report.json`, including incomplete answer evidence. A completed `export` writes private `.quorum/audit.json`, containing the frozen source, owner declaration and analysis. Exporting a diagnostic does not authorize a configuration change.

For each read/write family, the analysis lists its threshold, availability, count of all qualifying subsets and all inclusion-minimal quorums with exact weights. `readWrite` tests every read quorum against every write quorum; `writeWrite` tests every pair of write quorums. Each property contains `intersects`, a reason and, when false, two disjoint quorum sets as a witness. Read/read intersection is not required.

Because weights are positive and the set is finite, every qualifying quorum contains a minimal quorum. A disjoint pair of larger quorums contains a disjoint pair of minimal quorums. Checking every minimal pair is therefore exhaustive for this model. A write quorum's intersection with itself is always nonempty.

`verdict` is `intersects` when both properties hold, `disjoint` when a property fails, or `unavailable` when either family is empty. Properties involving an empty family use `intersects: null`; they never report vacuous safety. An available write family can still have a write/write result when the read family is unavailable. The overall session status `complete` means the declared profile was audited, including negative and unavailable results.

Weights can make a simple threshold-sum test inconclusive: three weight-2 replicas with read and write thresholds of 3 require two replicas per quorum, so all required intersections hold even though the threshold sum equals total weight. This starter checks the actual subsets.

The audit establishes finite-set intersection only. It does not establish consensus, linearizability, correct version handling, node availability, partition behavior, Byzantine tolerance or safe reconfiguration. Those depend on the actual protocol and deployment.

## Adapt and resume

Write an adapter that exports the complete replica roster, fixed weights and documented candidate threshold profiles. Call `auditQuorums(rawInput, profileId)` in `src/model.js` for the pure calculation; CLI export additionally requires the attributed owner declaration. Read the JSON result in your configuration review tool. No deployment or external-action adapter is included.

Real inputs, configuration, credentials, state and outputs are ignored by Git. Keep `.quorum/` and `.pingroom/` private. Writes are atomic under a local lock; changed input, owner, room or credentials cannot reuse the session.

A lost creation response leaves `create_unknown` and never triggers an automatic resend:

```sh
npm run status
npm run find-id
npm run recover -- EXACT-QUESTION-UUID
```

Recover only the original Question. An empty bounded search does not prove creation failed. Resolve or revoke uncertain/expired pairing in Connected Agents before archiving its pending record. Remove a stale `.lock` only after confirming its process stopped. Keep the original input and session while resolving uncertainty.

Run commands serially. Exit codes: `0` complete/local result; `1` invalid setup/evidence or refused export; `2` incomplete/Unknown/failed answer; `3` ready/pending/interrupted; `4` uncertain creation. Local status/report return 0 even for incomplete states; inspect their JSON status.

Tests compare every qualifying-set pair against an independent oracle across 8,420 small weighted configurations, plus maximum inputs, unavailable families, witness validity, provenance, recovery, pairing and real CLI subprocesses. GitHub Actions runs Node.js 22 and 24. Live phone delivery is not tested. MIT licensed.
