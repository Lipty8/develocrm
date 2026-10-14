import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('completed remains visible, archive independent of lifecycle and active KPI',()=>{
 execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import {isActiveProject,isArchivedProject,matchesProjectVisibility} from './app/lib/project-visibility.ts';
 const active={lifecycleStatus:'active'},completed={lifecycleStatus:'completed'},archived={lifecycleStatus:'completed',archivedAt:'2026-10-14T10:00:00Z'};
 assert.equal(isActiveProject(active),true);assert.equal(isActiveProject(completed),false);
 assert.equal(matchesProjectVisibility(completed,'visible'),true);assert.equal(matchesProjectVisibility(completed,'completed'),true);
 assert.equal(matchesProjectVisibility(archived,'visible'),false);assert.equal(matchesProjectVisibility(archived,'archived'),true);
 assert.equal(matchesProjectVisibility(archived,'all'),true);assert.equal(isArchivedProject({lifecycleStatus:'archived'}),true);
 `],{cwd:process.cwd(),stdio:'pipe'});
});
