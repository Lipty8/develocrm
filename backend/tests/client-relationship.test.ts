import assert from "node:assert/strict";
import test from "node:test";
import {deriveClientRelationshipStatus,normalizeClientRelationshipStatus} from "../src/shared/client-relationship.js";

test("klientský vztah používá pouze tři business stavy",()=>{
  assert.equal(deriveClientRelationshipStatus({archived:false,activeBuyerRelationship:true}),"Aktivní klient");
  assert.equal(deriveClientRelationshipStatus({archived:false,activeBuyerRelationship:false}),"Zájemce");
  assert.equal(deriveClientRelationshipStatus({archived:true,activeBuyerRelationship:true}),"Archiv");
  assert.equal(normalizeClientRelationshipStatus("Předáno"),"Aktivní klient");
  assert.equal(normalizeClientRelationshipStatus("Archivovaný"),"Archiv");
});
