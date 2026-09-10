import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("Úkoly používají sdílený picker, jednotnou mřížku a skutečné řádkové akce",async()=>{
  const [app,columns,menu,route,repository]=await Promise.all([
    readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/components/table-column-config.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/components/row-action-menu.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/api/tasks/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../backend/src/tasks/repository.ts",import.meta.url),"utf8"),
  ]);
  assert.match(app,/useTableColumns\("tasks-table",taskTableColumns\)/);
  assert.match(app,/Vytvořeno/);assert.match(app,/Aktualizováno/);
  assert.match(app,/task-head-controls/);assert.match(app,/gridTemplateColumns:taskGridTemplate/g);
  assert.match(app,/RowActionMenu/);assert.match(app,/Upravit úkol/);assert.match(app,/Označit jako dokončený/);assert.match(app,/Archivovat/);
  assert.match(columns,/createPortal/);assert.match(menu,/createPortal/);
  assert.match(route,/\/v1\/tasks\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(repository,/async update/);assert.match(repository,/task\.updated\.v1/);assert.match(repository,/tasks\.manage/);
});

test("editace úkolu používá vazbu UUID a české datumové formátování",async()=>{
  const [app,taskRepository]=await Promise.all([
    readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/repositories/task-repository.ts",import.meta.url),"utf8"),
  ]);
  assert.match(app,/function TaskEditModal/);
  assert.match(app,/formatPragueDateTime\(task\.createdAt\)/);
  assert.match(app,/openTaskObject/);
  assert.match(taskRepository,/async update/);
  assert.doesNotMatch(taskRepository,/object\.split/);
});
