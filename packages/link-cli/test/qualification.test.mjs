import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredModels } from '../qualify-installed.mjs';

test('qualification covers configured adapters even when routing has no fallback', () => {
  const config = {agents:{defaults:{},entries:{main:{model:{primary:'provider/primary',fallbacks:[]},
    models:{'provider/primary':{agentRuntime:{id:'first'}},'other/alternate':{agentRuntime:{id:'second'}}}}}}};
  assert.deepEqual(configuredModels(config,'main'),['provider/primary','other/alternate']);
  delete config.agents.entries.main.models;
  assert.throws(()=>configuredModels(config,'main'),/inventory/);
});
