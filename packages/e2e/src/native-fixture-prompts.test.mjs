import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertFinalProviderPrompt} from './native-fixture.mjs';
test('native provider phases do not require a mock request without prompt assertions',()=>{
  assert.doesNotThrow(()=>assertFinalProviderPrompt(undefined,{sends:[]}));
});
test('prompt assertions cannot silently pass without a captured request',()=>{
  assert.throws(()=>assertFinalProviderPrompt(undefined,{finalPromptIncludes:['fact']}));
  assert.throws(()=>assertFinalProviderPrompt(undefined,{finalPromptExcludes:['secret']}));
});
test('captured prompt assertions still enforce inclusion and exclusion',()=>{
  const request={messages:[{role:'user',content:'synthetic fact'}]};
  assertFinalProviderPrompt(request,{finalPromptIncludes:['fact'],finalPromptExcludes:['secret']});
  assert.throws(()=>assertFinalProviderPrompt(request,{finalPromptIncludes:['missing']}));
  assert.throws(()=>assertFinalProviderPrompt(request,{finalPromptExcludes:['fact']}));
});
