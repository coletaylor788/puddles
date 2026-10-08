#!/usr/bin/env node
// Artifact-only DEV rehearsal. Account adapters and the model are recording fixtures.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyBuildReceipt } from '../src/native-release.mjs';
import { installRuntime } from '../src/native-package.mjs';
import { atomicJson, treeDigest } from '../src/native-state.mjs';
import { assertDeploymentOwnership, readCoordination } from '../src/deploy-coordination.mjs';
import { installSignalHandlers } from '../src/process-runner.mjs';
import { cleanupNativeFixtures } from '../src/native-fixture.mjs';
import { communicationFixture } from '../fixtures/communication.mjs';

installSignalHandlers({ cleanup: cleanupNativeFixtures });
const [receiptPath, requestedRoot] = process.argv.slice(2);
assert.ok(receiptPath && requestedRoot, 'Usage: communication-dev.mjs imported-build.json new-run-root');
const coordination = process.env.PUDDLES_DEPLOY_COORDINATION;
assert.ok(coordination, 'DEV must run under the maintained slot controller');
const target = readCoordination(coordination).environments.DEV.target;
assert.equal(target.host, hostname());
const ownership = assertDeploymentOwnership({ ...target, coordination: { path: coordination } }, 'DEV');
assert.ok(ownership);
const build = JSON.parse(readFileSync(receiptPath, 'utf8')); verifyBuildReceipt(build);
assert.equal(build.artifact.platform, process.platform); assert.equal(build.artifact.arch, process.arch); assert.equal(build.artifact.node, process.version);
const extra = build.additionalArtifacts.find(a => a.id === 'communication-watcher'); assert.ok(extra, 'CI bundle must include the watcher');
const root = resolve(requestedRoot); assert.ok(!existsSync(root), 'Use a fresh owned rehearsal directory'); mkdirSync(root, { mode: 0o700 });
const installed = await installRuntime(build.artifact, join(root, 'installed'));
const plugin = await installRuntime(extra.artifact, join(root, 'plugin'));
const before = [installed, plugin].map(path => treeDigest(path, { portable: true }));
const result = await communicationFixture(installed, plugin, join(root, 'fixture'), { docker: true, port: target.port });
assert.equal(result.detachedRepliesValidated, true, 'DEV requires the upgraded native reply lifecycle');
assert.deepEqual([installed, plugin].map(path => treeDigest(path, { portable: true })), before);
const evidence = join(root, 'evidence.json');
atomicJson(evidence, { buildId: build.buildId, artifactSha256: build.artifact.sha256, pluginSha256: extra.artifact.sha256, result, cleanup: 'Gateway stopped and fixture containers removed' });
atomicJson(join(root, 'dev-proof.json'), { schema: 'puddles.dev-validation/v1', status: 'passed', head: build.repository.head, tree: build.repository.tree, owner: ownership.owner.agent.id, evidence });
console.log(JSON.stringify({ status: 'passed', proof: join(root, 'dev-proof.json') }));
