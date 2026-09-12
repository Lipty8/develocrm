# DeveloCRM Phase 0 authorization matrix

Every `/v1/*` request first requires a valid delegated Microsoft Entra access token. The token is resolved to an active user and tenant membership before a repository or domain command is called. Tenant RLS is enabled and forced on tenant data; project permissions are evaluated with `app.has_project_permission`.

| Domain | Read permission | Mutation permission | Tenant isolation | Project isolation | Automated evidence |
| --- | --- | --- | --- | --- | --- |
| Identity and roles | `users.manage`, `roles.manage` | `users.manage`, `roles.manage` | RLS + composite tenant FKs | role assignment validates project ownership | `block-a.test.ts`, `v31-iam.test.ts`, `v32-rbac-pricing.test.ts` |
| Projects | `projects.read` | `projects.create`, `projects.update`, `projects.change_manager`, `projects.change_status` | RLS + composite tenant FKs | project-scoped assignment | `block-b.test.ts`, `v40-project-creation.test.ts`, `v51-project-onboarding.test.ts` |
| Units and accessories | `units.read`, `accessories.read` | `units.update`, `units.update_sales_status`, `accessories.update` | RLS + composite tenant/project FKs | unit/accessory must belong to authorized project | `block-b.test.ts`, `v50-accessory-contract-pricing.test.ts`, `v51-project-onboarding.test.ts` |
| Clients and sales cases | `clients.read_all` or scoped equivalent, `sales_cases.read` | `clients.create`, `clients.update`, `clients.archive`, `sales_cases.manage` | RLS + canonical party tenant ownership | project and party scope are both checked | `block-c.test.ts`, `v46-party-prereservation.test.ts`, `v47-client-integrity.test.ts` |
| Contracts and prices | `contracts.read`, `prices.read` | `contracts.create`, `contracts.update`, `contracts.record_signature`, `prices.propose`, `prices.approve` | RLS + composite tenant/project links | active sales case and project permission | `block-d.test.ts`, `v32-rbac-pricing.test.ts`, `v44-contract-signing.test.ts`, `v49-contract-workflow.test.ts` |
| Documents | `documents.read` plus sensitive-document permission where applicable | `documents.create`, `documents.update`, `documents.review`, `documents.archive` | RLS + concrete tenant links | every project/unit/party/contract link is validated | `documents.test.ts` |
| Payments | `payments.read` | `payments.manage` | RLS + tenant-scoped transaction/allocation links | obligation, unit and sales case must share project | `payments.test.ts` |
| Handovers | `handovers.read` | `handovers.manage` | RLS + tenant-scoped participants | unit ownership and project permission | `v41-pilot-operations.test.ts`, `v42-mvp-workflow.test.ts` |
| Tasks and client changes | `tasks.read`, appropriate client-change read access | `tasks.manage`, client-change mutation permission | RLS + tenant-scoped actors | linked entities must belong to the project | `practical-editing.test.ts`, `v42-mvp-workflow.test.ts` |
| Media | `media.read` | `media.manage` | RLS + metadata ownership; storage key never authorizes | metadata resolves the owning project before permission evaluation | `security-phase0.test.ts` |

The Phase 0 API test also injects unauthenticated requests across projects, units, clients, contracts, payments, documents, tasks, handovers, client changes and media. Every request must return the same sanitized `401` envelope before database access.
