import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLinkSkills } from '../skills.mjs';

test('installs scoped skills without replacing other skills and refuses conflicting or linked destinations', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'link-skills-')));
  try {
    const config = {agents:{entries:{main:{workspace:join(root,'main')},'browser-agent':{workspace:join(root,'browser')}}}};
    for (const [agent, skill] of [['main','link-financial-insights'],['browser-agent','link-payments']]) {
      mkdirSync(join(config.agents.entries[agent].workspace,'skills/existing'),{recursive:true});
      writeFileSync(join(config.agents.entries[agent].workspace,'skills/existing/keep'),'unchanged');
      mkdirSync(join(root,'tools/link-cli/puddles-skills',skill),{recursive:true});
      writeFileSync(join(root,'tools/link-cli/puddles-skills',skill,'SKILL.md'),skill);
    }
    const receipts = installLinkSkills(config,root);
    assert.deepEqual(installLinkSkills(config,root),receipts);
    assert.equal(existsSync(join(root,'main/skills/link-payments')),false);
    assert.equal(existsSync(join(root,'browser/skills/link-financial-insights')),false);
    assert.equal(readFileSync(join(root,'main/skills/existing/keep'),'utf8'),'unchanged');
    rmSync(receipts[0].path,{recursive:true});
    writeFileSync(join(receipts[1].path,'SKILL.md'),'owner edit');
    assert.throws(()=>installLinkSkills(config,root),/reconciliation/);
    assert.equal(existsSync(receipts[0].path),false,'preflight must finish before any installation');
    rmSync(receipts[1].path,{recursive:true});
    symlinkSync(join(root,'tools/link-cli/puddles-skills/link-payments'),receipts[1].path);
    assert.throws(()=>installLinkSkills(config,root),/symlinks/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
