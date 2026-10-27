# Dejvice seller configuration

## Authorization and scope

Adam explicitly approved transferring seller identification, representative,
contacts and bank accounts from the approved RS/SBK originals into Rezidence
Dejvice project settings. This is an authorized change to actual prospective
project configuration, not a synthetic-only mutation. No existing contract,
document, price, payment prescription or historical snapshot was edited.

Project: `648b5e62-9784-4de9-929d-c89b7ffc3c50`.

## Source verification

- Read the actual supplied SBK Word. SHA-256 exactly matches the approved source
  `bc79743f8c9561a51f015a02a8a083416a3b12d32918875f2a974bce2a22c160`.
- The currently available RS package has SHA-256
  `d90487591386a29a4584ecafe253af86d7b1beba6365720f441b8ebc55e08152`,
  different from the approved package fingerprint. Every visible document-body
  paragraph nevertheless matches the original paragraph hash array in the
  pinned RS review manifest (zero differences). This is not a claim of byte-for-byte
  identity; no new legal source was substituted or parameterized.
- Seller values match the pinned original replacement spans and the exact SBK
  source: company, registration, seat, registry, representative, email, data box,
  purchase account/bank, client-change account and signature-name form.
- Seller delivery address follows SBK delivery clause referring to the address
  in its heading. No invented address was added.
- The existing 30-day default agrees with the actual RS clauses (30 calendar
  days from signature); it was not inferred from document creation.
- Only whitespace grouping was normalized in UI values. No legal paragraph,
  signature date, obligation or contract-level snapshot was rewritten.
- Bank/contact values are not repeated in this repository report.

## Persistence and evidence

Used the existing authenticated project edit form as Adam, with the existing
contract.manage/project authorization and standard transactional update route.
All twelve text fields were populated; project name, lifecycle, construction
stage, manager and completion month remained unchanged.

After save, project activity showed `Upraveny smluvní údaje prodávajícího`.
After a full reload, reopening the form showed all twelve saved fields and
the 30-day setting. The existing backend operation writes its audit and outbox;
no ad-hoc SQL or permission bypass was used.

Read-only readiness of existing `DEJ-312-RS`
(`d8835470-f4b3-488f-893f-06e8c1c05d65`) now shows the actual seller and no
missing-seller issues. Generation remains correctly blocked by the other
previously identified omissions (buyer details, variant/accessory compatibility,
appendix selections, signature plans, payment terms and historic price/fee
snapshot). No generation or signature action was attempted on this real draft.

No code/migration/deployment was required for this configuration change.
The separately tested duplicate-review release is the current Sites 172.

## Deferred accessory facts

Adam confirmed P30 is another outdoor place, then explicitly deferred the
remaining P1–P29 outdoor/garage mapping and exact garage shares. No bulk
classification, guessed 1/25 share, assignment, price change or deletion was
performed. P30's confirmation remains recorded here; the inventory was not
partially rewritten during this seller-settings operation. Contract readiness
continues to require verified facts where the selected legal wording needs them.

The previously deferred missing appendix files remain deferred as instructed.
