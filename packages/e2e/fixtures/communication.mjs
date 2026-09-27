import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { cpSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, realpathSync, symlinkSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { runCommand, installSignalHandlers } from '../src/process-runner.mjs';
import { isolatedContext, fixtureEnv, registerNativeFixture, cleanupNativeFixtures } from '../src/native-fixture.mjs';

/** Real gateway and tool execution, with scripted models and recording-only account adapters. */
export async function communicationFixture(installedDir, pluginDir, root, options = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 }); root = realpathSync(root);
  installedDir = realpathSync(installedDir);
  const { configure, SYSTEM_FILES } = await import(pathToFileURL(join(realpathSync(pluginDir), "scripts/configure.mjs")).href);
  const context = isolatedContext(root);
  const containerPrefix = `communication-fixture-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-`;
  const docker = args => runCommand("docker", args, { capture: true, quiet: true, timeoutMs: 30000 });
  const containers = async () => (await docker(["ps", "-a", "--filter", `name=${containerPrefix}`, "--format", "{{.Names}}"])).trim().split("\n").filter(name => name.startsWith(containerPrefix));
  const checkMounts = async () => {
    const names = await containers();
    const entries = JSON.parse(await docker(["inspect", ...names]));
    const entry = entries.find(e => e.Mounts.some(m => m.Source === join(workspace, "AGENTS.md")));
    assert.ok(entry, "watcher Docker container exists");
    for (const file of SYSTEM_FILES) assert.equal(entry.Mounts.find(m => m.Destination === `/workspace/${file}`)?.RW, false, `${file} is read-only`);
    assert.equal(entry.HostConfig.NetworkMode, "none");
    await docker(["exec", entry.Name.slice(1), "sh", "-c", 'for f in AGENTS.md SOUL.md IDENTITY.md USER.md TOOLS.md HEARTBEAT.md BOOTSTRAP.md BOOT.md MEMORY.md; do if echo forbidden >> "/workspace/$f" 2>/dev/null; then exit 1; fi; done; touch /workspace/memory/.fixture && rm /workspace/memory/.fixture']);
    return entry.Name.slice(1);
  };
  const version = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8')).version;
  const [year, month, patch] = version.split('.').map(v => parseInt(v, 10));
  const supportsDetachedReplies = year > 2026 || year === 2026 && (month > 9 || month === 9 && patch >= 6);
  const requests = [], receipts = [];
  const sender = createHash('sha256').update('+15555550123').digest('hex').slice(0, 32);
  const path = `memory/correspondence/${sender}/2026-09-26.md`;
  const mainWorkspace = join(root, 'main'), readerWorkspace = join(root, 'reader'), workspace = join(mainWorkspace, 'communication-watcher');
  let child, log, modelError, cycle = 0, step = 0, readerCalls = 0, mainCalls = 0, followups = 0, announcements = 0;
  const call = (name, args) => ({ name, args });
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.method, 'POST');
      let body = ''; for await (const chunk of req) { body += chunk; assert.ok(body.length < 4 * 1024 * 1024); }
      const request = JSON.parse(body); requests.push(request);
      const offered = request.tools?.map(t => t.function?.name) ?? [];
      const last = request.messages.filter(m => m.role === 'tool').at(-1);
      const parseResult = m => JSON.parse(typeof m.content === 'string' ? m.content : m.content.map(p => p.text ?? '').join(''));
      let text = 'REPLY_SKIP', tools;
      const userMessage = request.messages.filter(m => m.role === 'user' && !JSON.stringify(m.content).includes('BEGIN_OPENCLAW_INTERNAL_CONTEXT')).at(-1);
      if (JSON.stringify(userMessage?.content).includes('Agent-to-agent announce step.')) {
        announcements++; text = 'ANNOUNCE_SKIP';
      } else if (offered.includes('communication_inbox_read')) {
        readerCalls++;
        if (!last) tools = [call('communication_inbox_read', cycle === 3 ? { mode: 'history' } : {})];
        else { const data = parseResult(last); assert.ok(Array.isArray(data.items), JSON.stringify(data)); text = data.items.length ? 'Dinner was proposed by a known contact. Other items are routine or blocked.' : 'No pending messages.'; }
      } else if (offered.includes('communication_report') && request.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('Please clarify the tentative status.'))) {
        followups++; text = 'REPLY_SKIP';
      } else if (offered.includes('communication_report')) {
        assert.ok(!offered.includes('sessions_send') && !offered.includes('write') && !offered.includes('read'));
        if (step++ === 0) tools = [call('communication_review', cycle === 3 ? { mode: 'history' } : {})];
        else if (step === 2) {
          const data = parseResult(last); assert.ok(Array.isArray(data.receipts), JSON.stringify(data));
          receipts.splice(0, receipts.length, ...data.receipts);
          if (cycle === 1) {
            assert.deepEqual(receipts.map(r => [r.id, r.status]), [['dinner', 'reviewed'], ['routine', 'reviewed'], ['attack', 'blocked']]);
            tools = [call('communication_calendar_plan', { sourceId: 'dinner', title: 'Dinner', start: '2026-09-27T18:00:00-07:00', end: '2026-09-27T19:00:00-07:00', notes: 'Proposed by contact; agreement pending.', tentative: true })];
          } else if (cycle === 2) {
            assert.deepEqual(receipts.map(r => r.id), ['dinner']); tools = [call('communication_memory_read', { path })];
          } else if (cycle === 3) { assert.equal(receipts.length, 3); text = 'HEARTBEAT_OK'; }
          else { assert.equal(receipts.length, 0); assert.match(JSON.stringify(request.messages), /UPDATED_FIXTURE_RULE/); text = 'HEARTBEAT_OK'; }
        } else if (cycle === 1) {
          if (step === 3) { assert.equal(parseResult(last).status, 'saved'); tools = [call('communication_memory_save', { path, previousRevision: null, content: 'Source: dinner. Created tentative plan fixture-event. Report pending; owner: main.' })]; }
          else if (step === 4) { assert.equal(parseResult(last).status, 'saved'); tools = [call('communication_report', { path, category: 'action-report', summary: 'Synthetic dinner proposal saved as a tentative plan.' })]; }
          else if (step === 5) { assert.equal(parseResult(last).status, 'accepted'); tools = [call('communication_inbox_complete', { ticket: receipts[0].ticket })]; }
          else if (step === 6 || step === 7) {
            assert.equal(parseResult(last).status, step === 6 ? 'unavailable' : 'completed');
            tools = [call('communication_inbox_complete', { ticket: receipts[step - 5].ticket })];
          } else { assert.equal(parseResult(last).status, 'completed'); text = 'HEARTBEAT_OK'; }
        } else if (cycle === 2) {
          if (step === 3) { assert.match(parseResult(last).text, /Main received report/); tools = [call('communication_calendar_read', { id: 'fixture-event' })]; }
          else if (step === 4) { assert.equal(parseResult(last).event.id, 'fixture-event'); tools = [call('communication_inbox_complete', { ticket: receipts[0].ticket })]; }
          else { assert.equal(parseResult(last).status, 'completed'); text = 'HEARTBEAT_OK'; }
        } else throw new Error('Unexpected watcher step');
      } else {
        mainCalls++;
        assert.match(JSON.stringify(request.messages), /agent:communication-watcher:/);
        if (!last) tools = [call('communication_memory_read', { path })];
        else {
          assert.match(parseResult(last).text, /fixture-event/);
          if (options.interrupt) {
            writeFileSync(join(root, 'main-reply.json'), JSON.stringify({ pending: true }));
            await delay(20_000);
            writeFileSync(join(root, 'main-reply.json'), JSON.stringify({ pending: false }));
          }
          text = supportsDetachedReplies ? 'Please clarify the tentative status.' : 'REPLY_SKIP';
        }
      }
      const message = { role: 'assistant', content: tools ? null : text };
      if (tools) message.tool_calls = tools.map((tool, index) => ({ index, id: `fixture_${requests.length}_${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }));
      const finish = tools ? 'tool_calls' : 'stop';
      const base = { id: `fixture-${requests.length}`, object: 'chat.completion', created: 1, model: 'fixture-model' };
      res.writeHead(200, { 'Content-Type': request.stream ? 'text/event-stream' : 'application/json' });
      if (request.stream) {
        res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else res.end(JSON.stringify({ ...base, choices: [{ index: 0, message, finish_reason: finish }] }));
    } catch (error) { modelError = error; res.writeHead(400); res.end('Unscripted fixture request'); }
  });
  const stop = async () => {
    if (!child?.pid) return;
    const closed = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('close', resolve));
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await Promise.race([closed, delay(5000)]);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await closed; child = undefined;
  };
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    writeFileSync(join(root, 'model-requests.json'), JSON.stringify(requests, null, 2));
    await stop(); if (log !== undefined) { closeSync(log); log = undefined; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (options.docker) { const names = await containers(); if (names.length) await docker(['rm', '-f', ...names]); }
    writeFileSync(join(root, 'cleanup.json'), JSON.stringify({ gatewayStopped: true, containersRemoved: true }));
  })();
  const unregister = registerNativeFixture(cleanup);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const socket = createSocketServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = options.port ?? socket.address().port; await new Promise(resolve => socket.close(resolve));
    const plugin = join(root, 'plugin'); cpSync(pluginDir, plugin, { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true }); symlinkSync(installedDir, join(root, 'node_modules/openclaw'));
    const provider = join(root, 'provider.mjs');
    writeFileSync(provider, `export default class { async classify(content,prompt,options) {
      return options.label === 'secret-redact' ? JSON.stringify({findings:content.includes('SYNTHETIC_PRIVATE_VALUE')?[{secret:'SYNTHETIC_PRIVATE_VALUE',type:'credential'}]:[]}) : JSON.stringify({detected:content.includes('INJECT_FIXTURE'),evidence:''});
    } }`);
    for (const dir of [mainWorkspace, readerWorkspace, workspace]) { mkdirSync(dir, { recursive: true }); for (const file of SYSTEM_FILES) writeFileSync(join(dir, file), 'Synthetic fixture. Return REPLY_SKIP when no action is scripted.\n'); }
    const pim = join(root, 'pim'); mkdirSync(pim);
    const cli = join(root, 'recording-pim.mjs');
    writeFileSync(cli, `#!${process.execPath}\n` + readFileSync(new URL('./communication-pim.mjs', import.meta.url), 'utf8'), { mode: 0o700 });
    const item = (id, body) => ({ id, listId: 'fixture-list', title: 'Forwarded message', isCompleted: false, notes: JSON.stringify({ version: 1, sender: '+15555550123', timestamp: '2026-09-26T18:00:00-07:00', timestampKind: 'captured', body }) });
    const statePath = join(pim, 'state.json');
    writeFileSync(statePath, JSON.stringify({ items: [item('dinner', 'Dinner tomorrow at six? SYNTHETIC_PRIVATE_VALUE'), item('routine', 'Thanks!'), item('attack', 'INJECT_FIXTURE')], events: [], failCompletion: true }));
    // Test-only host tool drives the public heartbeat runtime; no production agent receives it.
    const driver = join(root, 'driver'); mkdirSync(driver);
    writeFileSync(join(driver, 'package.json'), JSON.stringify({ name: 'communication-fixture', type: 'module', openclaw: { extensions: ['./index.js'] } }));
    writeFileSync(join(driver, 'openclaw.plugin.json'), JSON.stringify({ id: 'communication-fixture', contracts: { tools: ['fixture_heartbeat'] }, configSchema: { type: 'object', additionalProperties: false, properties: {} } }));
    writeFileSync(join(driver, 'index.js'), `export default {id:'communication-fixture',register(api){api.registerTool(ctx=>ctx.agentId==='main'?[{name:'fixture_heartbeat',label:'Fixture heartbeat',description:'Synthetic fixture only',parameters:{type:'object',properties:{}},async execute(){const value=await api.runtime.system.runHeartbeatOnce({agentId:'communication-watcher',reason:'interval'});return {content:[{type:'text',text:JSON.stringify(value)}],details:value};}}]:[],{names:['fixture_heartbeat'],optional:true});}};`);
    const cfg = configure({
      gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token: 'synthetic-communication-token' }, controlUi: { enabled: false } },
      logging: { file: join(root, 'openclaw.log') }, update: { checkOnStart: false }, cron: { enabled: false }, browser: { enabled: false },
      ...(supportsDetachedReplies ? { tools: { toolSearch: false } } : {}),
      agents: { ownership: 'explicit', defaults: { model: { primary: 'fixture/fixture-model' }, compaction: { mode: 'default' }, heartbeat: { every: '0m' } }, entries: { main: { workspace: mainWorkspace, tools: { allow: ['communication_memory_read', 'fixture_heartbeat'] } } } },
      models: { mode: 'replace', providers: { fixture: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic', models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 128000, maxTokens: 4096, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } },
      plugins: { allow: ['communication-watcher', 'communication-fixture'], slots: { memory: 'none' }, load: { paths: [driver] } },
    }, { mainWorkspace, readerWorkspace, pluginPath: plugin, enableHeartbeat: true,
      pluginConfig: { watcherAgent: 'communication-watcher', readerAgent: 'communication-reader', mainSession: 'agent:main:main', listId: 'fixture-list', calendarId: 'fixture-calendar', reminderCli: cli, calendarCli: cli, configDir: pim, profile: 'fixture', llmProvider: provider } });
    // Docker mounts receive a separate installed DEV assertion; this proof exercises the actual gateway/tool lifecycle.
    for (const agent of ['communication-watcher', 'communication-reader']) {
      if (options.docker) cfg.agents.entries[agent].sandbox.docker.containerPrefix = containerPrefix;
      else cfg.agents.entries[agent].sandbox = { mode: 'off' };
    }
    writeFileSync(context.configPath, JSON.stringify(cfg));
    log = openSync(join(root, 'gateway.log'), 'a', 0o600);
    const start = async () => {
      child = spawn(process.execPath, [join(installedDir, 'openclaw.mjs'), 'gateway', 'run', '--port', String(port), '--bind', 'loopback'], { cwd: workspace, env: fixtureEnv(context), detached: true, stdio: ['ignore', log, log] });
      writeFileSync(join(root, 'gateway-pid.json'), JSON.stringify({ pid: child.pid, port }));
      for (let i = 0; i < 600; i++) {
        if (child.exitCode !== null) throw new Error('Gateway exited: '+readFileSync(join(root, 'gateway.log'), 'utf8').slice(-4000));
        try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {}
        await delay(100);
      }
      throw new Error('Gateway startup timed out');
    };
    const invoke = async (tool, args, sessionKey = 'agent:communication-watcher:fixture') => {
      const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, { method: 'POST', headers: { authorization: 'Bearer synthetic-communication-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args, sessionKey }) });
      return { httpStatus: response.status, body: await response.json() };
    };
    const heartbeat = async () => {
      cycle++; step = 0;
      const value = await invoke('fixture_heartbeat', {}, 'agent:main:fixture-driver');
      if (modelError) throw modelError;
      assert.equal(value.body.result?.details?.status, 'ran', JSON.stringify(value));
      await delay(500);
    };
    await start(); await delay(1000); assert.equal(requests.length, 0, 'source arrival must not wake an agent');
    await heartbeat();
    // Detached sends give each native reply up to 30 seconds. Observe completion
    // within that budget; the interruption proof instead stops an active reply.
    const waitForReply = async (ready, stage) => {
      const deadline = Date.now() + 30_000;
      while (!ready() && Date.now() < deadline && !modelError) await delay(100);
      if (modelError) throw modelError;
      assert.ok(ready(), `Native ${stage} did not settle: ${JSON.stringify({ mainCalls, followups, announcements })}\n${readFileSync(join(root, 'gateway.log'), 'utf8').slice(-8000)}`);
    };
    await waitForReply(() => mainCalls >= 2, 'main reply');
    if (options.interrupt) {
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'main-reply.json'), 'utf8')), { pending: true });
      process.kill(process.pid, 'SIGTERM'); await new Promise(() => {});
    }
    if (supportsDetachedReplies) {
      await waitForReply(() => followups >= 1, 'watcher follow-up');
      await waitForReply(() => announcements >= 1, 'silent announcement');
    }
    assert.equal(mainCalls, 2, 'main reads the guarded handoff');
    assert.equal(followups, supportsDetachedReplies ? 1 : 0, 'native follow-up ends without another intake sweep');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.deepEqual(state.items.map(i => i.isCompleted), [false, true, true]); assert.equal(state.events.length, 1);
    assert.match(state.events[0].title, /^Tentative: /);
    if (options.docker) await checkMounts();
    const oldTicket = receipts[0].ticket;
    assert.equal((await invoke('write', { path: 'AGENTS.md', content: 'escape' })).httpStatus, 404);
    assert.equal((await invoke('sessions_send', { sessionKey: 'agent:main:main', message: 'raw escape' })).httpStatus, 404);
    assert.equal((await invoke('communication_memory_save', { path: 'AGENTS.md', content: 'escape', previousRevision: null })).body.result?.details?.status, 'denied');
    // Main owns the shared note. Its saved receipt is available to the next fresh heartbeat.
    writeFileSync(join(workspace, path), readFileSync(join(workspace, path), 'utf8') + '\nMain received report. Owner: main. No further alert is needed.\n');
    await stop(); await start();
    assert.equal((await invoke('communication_inbox_complete', { ticket: oldTicket })).body.result?.details?.status, 'denied');
    await heartbeat();
    assert.ok(JSON.parse(readFileSync(statePath, 'utf8')).items.every(i => i.isCompleted));
    const afterRecovery = readFileSync(join(workspace, path), 'utf8');
    await heartbeat(); // Guarded completed history, including the quarantined item.
    writeFileSync(join(workspace, 'AGENTS.md.next'), 'UPDATED_FIXTURE_RULE\n');
    renameSync(join(workspace, 'AGENTS.md.next'), join(workspace, 'AGENTS.md'));
    if (options.docker) {
      await runCommand(process.execPath, [join(installedDir, 'openclaw.mjs'), 'sandbox', 'recreate', '--agent', 'communication-watcher', '--force'], { env: fixtureEnv(context), capture: true, timeoutMs: 30000 });
    }
    await heartbeat(); // Empty pending read in a fresh heartbeat sees the host rule edit.
    assert.equal(readFileSync(join(workspace, path), 'utf8'), afterRecovery, 'history and empty reads do not rewrite memory');
    if (options.docker) {
      const container = await checkMounts();
      assert.match(await docker(['exec', container, 'cat', '/workspace/AGENTS.md']), /UPDATED_FIXTURE_RULE/);
    }
    const calls = readFileSync(join(pim, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(c => c[0] === 'create').length, 1, 'recovery does not repeat calendar creation');
    assert.equal(mainCalls, 2, 'recovery does not repeat main reports');
    assert.equal(announcements, supportsDetachedReplies ? 1 : 0, 'native final announcement stays silent');
    assert.equal(readerCalls, 8, 'one bounded reader job per heartbeat');
    const readerFiles = readdirSync(join(context.stateDir, 'agents/communication-reader/sessions')).filter(p => p.endsWith('.jsonl'));
    assert.deepEqual(readerFiles, [], 'reader transcripts are deleted');
    const visible = JSON.stringify(requests);
    assert.ok(!visible.includes('SYNTHETIC_PRIVATE_VALUE') && !visible.includes('INJECT_FIXTURE'), 'raw source text must not reach any agent');
    const result = { passed: true, heartbeatCycles: cycle, mainCalls, readerCalls, followups, nativeProvenance: true, recoveryWithoutDuplicate: true, rawToolsDenied: true, ruleRefresh: true, readOnlyMounts: options.docker === true, detachedRepliesValidated: supportsDetachedReplies };
    writeFileSync(join(root, 'result.json'), JSON.stringify(result)); return result;
  } finally {
    try { await cleanup(); } finally { unregister(); }
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  installSignalHandlers({ cleanup: cleanupNativeFixtures });
  const [installedDir, pluginDir, root] = process.argv.slice(2, 5).map(path => resolve(path));
  console.log(JSON.stringify(await communicationFixture(installedDir, pluginDir, root, { docker: process.argv.includes("--docker"), interrupt: process.argv.includes("--interrupt") })));
}
