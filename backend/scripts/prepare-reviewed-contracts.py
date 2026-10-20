#!/usr/bin/env python3
"""Pinned, reversible source parameterization. No approval or runtime DB writes.

Only exact text spans change. The existing TypeScript renderer renders samples;
this tool is NOT another document renderer or template persistence layer.
"""
import argparse
import hashlib
import html
import json
import re
import zipfile
from pathlib import Path

P = re.compile(r'<w:p(?:\s[^>]*)?>.*?</w:p>', re.S)
T = re.compile(r'(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)', re.S)
HASHES = {
    'rs': 'b57cfd799b64e79641c6cc78684cbfd053f14439102447d09e08d83e3af721bd',
    'sbk': 'bc79743f8c9561a51f015a02a8a083416a3b12d32918875f2a974bce2a22c160',
}


def visible(xml):
    return ''.join(html.unescape(m[2]) for m in T.finditer(xml))


def replace_span(xml, start, end, replacement):
    """Keep every run/property and put replacement in the first touched text node."""
    offset = 0
    edits = []
    inserted = False
    for match in T.finditer(xml):
        text = html.unescape(match[2])
        a, b = offset, offset + len(text)
        offset = b
        if b <= start or a >= end:
            continue
        value = text[:max(0, start-a)]
        if not inserted:
            value += replacement
            inserted = True
        value += text[max(0, end-a):] if end < b else ''
        edits.append((match.start(2), match.end(2), html.escape(value, quote=False)))
    if not inserted:
        raise ValueError('slot does not touch a Word text node')
    for a, b, value in reversed(edits):
        xml = xml[:a] + value + xml[b:]
    return xml


def parameterize(kind, source, out, delivery_version=False):
    if delivery_version and kind != 'sbk':
        raise ValueError('delivery profile is supported only for SBK')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != HASHES[kind]:
        raise ValueError(f'{kind}: source hash differs; audit this version first')
    with zipfile.ZipFile(source) as archive:
        original = archive.read('word/document.xml').decode('utf-8')
        paragraphs = list(P.finditer(original))
        texts = [visible(p[0]) for p in paragraphs]
        slots = []
        values = {}

        def slot(i, old, key, sample):
            if texts[i].count(old) != 1:
                raise ValueError(f'{kind} paragraph {i}: slot not unique: {key}')
            start = texts[i].index(old)
            slots.append({'paragraph': i, 'start': start, 'end': start+len(old),
                          'original': old, 'replacement': '{{'+key+'}}', 'key': key})
            if key in values and values[key] != sample:
                raise ValueError('inconsistent sample')
            values[key] = sample

        def pattern(i, expression, key, sample, occurrence=0):
            found = list(re.finditer(expression, texts[i]))
            if len(found) <= occurrence:
                raise ValueError(f'{kind} paragraph {i}: pattern missing for {key}')
            match = found[occurrence]
            slots.append({'paragraph': i, 'start': match.start(), 'end': match.end(),
                          'original': match[0], 'replacement': '{{'+key+'}}', 'key': key})
            values[key] = sample

        def occurrences(i, expression, key, sample, expected):
            found = list(re.finditer(expression, texts[i]))
            if len(found) != expected:
                raise ValueError(f'{kind} paragraph {i}: unexpected occurrence count: {key}')
            for occurrence in range(expected):
                pattern(i, expression, key, sample, occurrence)

        seller_start = 4 if kind == 'rs' else 2
        seller = [
            ('seller.name', 'Rezidence Dejvice 2 s.r.o.'),
            ('seller.address', 'Rohanské nábřeží 693/ 10, Praha 8 - Karlín, 186 00'),
            ('seller.registryEntry', 'zapsaná v Obchodním rejstříku vedeném Městským soudem v Praze, oddíl C vložka 439 174'),
            ('seller.registrationNumber', '241 06 119'),
            ('seller.representative', 'jednatelem, Ing. Jaroslavem Žahourkem'),
            ('seller.email', 'jaroslav.zahourek@immobuilding.cz'),
            ('seller.dataBox', 'nymania'),
        ]
        for n, (key, sample) in enumerate(seller):
            i = seller_start+n
            prefixes = ['', 'se sídlem ', '', 'IČ: ', 'zastoupená ', '', 'Datová schránka: ']
            value = texts[i].removeprefix('(1)').removeprefix(prefixes[n]).removesuffix(';')
            slot(i, value, key, sample)
        bank_i = 13 if kind == 'rs' else 11
        pattern(bank_i, r'178[\s\u00a0]*412\s*7011\s*/\s*2700', 'seller.bankAccount', '178 412 7011 / 2700')
        # Preserve source banking/legal wording. Bank name itself is project data.
        pattern(bank_i, r'UniCredit Bank Czech Republic and Slovakia, a\.s\.', 'seller.bankName', 'UniCredit Bank Czech Republic and Slovakia, a.s.')
        pattern(20, r'Paní/ Pan|Pan/paní', 'buyer.salutation', 'Pan')
        pattern(20, r'[.…]{3,}', 'buyer.name', 'TESTOVACÍ KUPUJÍCÍ NEPODEPISOVAT')
        pattern(21, r'[.…]{3,}', 'buyer.address', 'Testovací 62, 160 00 Praha 6')
        birth_i = 22 if kind == 'rs' else 23
        # Explicitly authorized by Adam for RS and, on 2026-10-17, SBK.
        slots.append({'paragraph': birth_i, 'start': 0, 'end': 2, 'original': 'RČ',
                      'replacement': 'Datum narození', 'key': None})
        pattern(birth_i, r'[.…]{3,}', 'buyer.birthDate', '1. 1. 1990')
        if kind == 'sbk':
            pattern(22, r'[.…]{3,}', 'buyer.deliveryAddress', 'Doručovací 62, 160 00 Praha 6')
        pattern(birth_i+1, r'[.…]{3,}', 'buyer.email', 'kupujici@example.test')
        pattern(birth_i+2, r'[.…]{3,}', 'buyer.phone', '+420 777 000 062')
        if kind == 'rs':
            pattern(25, r'[.…]{3,}', 'buyer.dataBox', 'neuvedena')
            pattern(57, r'…', 'unit.code', 'T-062', 0)
            pattern(57, r'…', 'unit.floorNumber', '3.', 1)
            slot(59, 'terase/ balkonu', 'unit.outdoorSpaceCase', 'balkonu')
            slot(61, 'P…', 'unit.outdoorParkingCode', 'P-TEST1')
            slot(63, 'S…', 'unit.cellarCode', 'S-TEST1')
            slot(63, '1.PP/1NP', 'unit.cellarFloor', '1.PP')
            slot(65, '1.PP/ 1.NP', 'unit.garageFloor', '1.PP')
            slot(65, 'P…', 'unit.garageCode', 'P-TEST2')
            slot(74, '250.000', 'payment.reservationFeeAmount', '250 000')
            slot(74, 'dvě stě padesát tisíc', 'payment.reservationFeeWords', 'dvě stě padesát tisíc')
            pattern(74, r'178[\s\u00a0]*412\s*7011\s*/\s*2700', 'seller.bankAccount', '178 412 7011 / 2700')
            pattern(74, r'UniCredit Bank Czech Republic and Slovakia a\.s\.', 'seller.bankName', 'UniCredit Bank Czech Republic and Slovakia, a.s.')
            pattern(74, r'[.…]{2,}', 'unit.variableSymbol', '62001')
            pattern(87, r'…+', 'contract.totalPriceAmount', '5 000 000', 0)
            pattern(87, r'…+\.?', 'contract.totalPriceWords', 'pět milionů', 1)
            signature_i = 133
        else:
            pattern(14, r'178[\s\u00a0]*412\s*7003\s*/\s*2700', 'seller.clientChangesBankAccount', '178 412 7003 / 2700')
            # Repeated identity and payment data use the same fields as the
            # introduction. Do NOT parameterize the named assignee/lender:
            # assignment of receivables is a pinned legal fact, not bank data.
            occurrences(73, r'Rezidence Dejvice 2 s\.r\.o\.', 'seller.name', 'Rezidence Dejvice 2 s.r.o.', 2)
            occurrences(73, r'Rohanské nábřeží 693/\s*10, Karlín, Praha 8, PSČ 186 00', 'seller.address', seller[1][1], 2)
            occurrences(73, r'241\s*06\s*119', 'seller.registrationNumber', '241 06 119', 2)
            for i in [73, 117, 118, 124]:
                pattern(i, r'178[\s\u00a0]*412\s*7011\s*/\s*2700', 'seller.bankAccount', '178 412 7011 / 2700')
            pattern(97, r'178[\s\u00a0]*412\s*7003\s*/\s*2700', 'seller.clientChangesBankAccount', '178 412 7003 / 2700')
            for i in [14, 97, 117, 118, 124]:
                pattern(i, r'UniCredit Bank Czech Republic and Slovakia,? a\.s\.', 'seller.bankName', 'UniCredit Bank Czech Republic and Slovakia, a.s.')
            # The first occurrence is the legal assignee; only the second
            # describes the bank holding the payment account.
            pattern(73, r'UniCredit Bank Czech Republic and Slovakia, a\.s\.', 'seller.bankName', 'UniCredit Bank Czech Republic and Slovakia, a.s.', 1)
            pattern(82, r'…', 'unit.code', 'T-062', 0)
            pattern(82, r'…', 'unit.floorNumber', '3.', 1)
            pattern(83, r'…', 'unit.area', '55,5')
            slot(85, 'Balkonu/ Terasy', 'unit.outdoorSpaceCase', 'Balkonu')
            pattern(85, r'…+', 'unit.outdoorSpaceArea', '5')
            pattern(86, r'\.{3,}', 'unit.gardenArea', '12')
            slot(87, 'P…', 'unit.outdoorParkingCode', 'P-TEST1')
            slot(90, '1.PP/1.NP', 'unit.garageFloor', '1.PP')
            slot(90, 'P…', 'unit.garageCode', 'P-TEST2')
            slot(92, 'S…', 'unit.cellarCode', 'S-TEST1')
            slot(92, '1.PP/1.NP', 'unit.cellarFloor', '1.PP')
            pattern(112, r'…', 'contract.totalPriceAmount', '5 000 000', 0)
            pattern(112, r'…', 'contract.totalPriceWords', 'pět milionů', 1)
            slot(116, '250.000,-', 'payment.reservationFeePaidAmount', '250 000')
            pattern(117, r'…', 'payment.firstInstallmentAmount', '1 000 000', 0)
            pattern(117, r'…', 'unit.variableSymbol', '62001', 1)
            pattern(118, r'…', 'payment.finalInstallmentAmount', '3 750 000', 0)
            pattern(118, r'…', 'unit.variableSymbol', '62001', 1)
            pattern(124, r'…', 'unit.variableSymbol', '62001')
            pattern(221, r'…+', 'buyer.deliveryAddress', 'Doručovací 62, 160 00 Praha 6')
            if delivery_version:
                slot(217, texts[217], 'seller.deliveryAddress', texts[217])
            signature_i = 252
        # Independent planned signing dates; no inference of actual signatures.
        pattern(signature_i, r'…+', 'contract.sellerPlannedDate', '16. 10. 2026', 0)
        pattern(signature_i, r'…+', 'contract.buyerPlannedDate', '16. 10. 2026', 1)
        # Signature name line is a separate source field, not newly composed prose.
        name_i = 146 if kind == 'rs' else 259
        slot(name_i, texts[name_i], 'seller.name', 'Rezidence Dejvice 2 s.r.o.')
        slot(name_i+1, texts[name_i+1], 'seller.signatureName', 'Ing. Jaroslav Žahourek, jednatel')
        for slot_data in slots:
            i, a, b = slot_data['paragraph'], slot_data['start'], slot_data['end']
            if texts[i][a:b] != slot_data['original']:
                raise ValueError('source span drift')
        new_paragraphs = [p[0] for p in paragraphs]
        for i in range(len(paragraphs)):
            changes = sorted([s for s in slots if s['paragraph'] == i], key=lambda s: s['start'], reverse=True)
            boundary = len(texts[i])
            for s in changes:
                if s['end'] > boundary:
                    raise ValueError('overlapping slots')
                boundary = s['start']
                new_paragraphs[i] = replace_span(new_paragraphs[i], s['start'], s['end'], s['replacement'])
        xml = original
        for p, new in reversed(list(zip(paragraphs, new_paragraphs))):
            xml = xml[:p.start()] + new + xml[p.end():]
        # All XML structure/attributes/formatting and all non-slot text preserved.
        if T.sub(r'\1\3', original) != T.sub(r'\1\3', xml):
            raise ValueError('non-text structure changed')
        inventory = {i.filename: hashlib.sha256(archive.read(i)).hexdigest() for i in archive.infolist()}
        out.mkdir(parents=True, exist_ok=True)
        stem = 'sbk-dejvice-original-delivery-review' if delivery_version else f'{kind}-dejvice-original-review'
        target = out / f'{stem}.docx'
        with zipfile.ZipFile(target, 'w') as result:
            for info in archive.infolist():
                result.writestr(info, xml.encode('utf-8') if info.filename == 'word/document.xml' else archive.read(info))
        with zipfile.ZipFile(target) as result:
            for name, digest in inventory.items():
                if name != 'word/document.xml' and hashlib.sha256(result.read(name)).hexdigest() != digest:
                    raise ValueError('preserve-only package part changed')
        manifest = {'contractType': kind, 'status': 'draft', 'activationAllowed': False,
                    'sourceSha256': HASHES[kind], 'sourceFileName': source.name,
                    'templateSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                    'schema': {'fields': {key: {'required': True} for key in sorted(values)}},
                    'sampleIsSynthetic': True, 'sampleValues': values,
                    'slots': slots, 'preserveOnlyParts': inventory,
                    'sourceStructureSha256': hashlib.sha256(T.sub(r'\1\3', original).encode()).hexdigest(),
                    'sourceParagraphTextSha256': [hashlib.sha256(text.encode()).hexdigest() for text in texts],
                    'scope': {'project': 'Rezidence Dejvice', 'buyerVariant': 'one_individual',
                              'accessoryVariant': 'all_source_accessories_present',
                              'buyerIdentifier': 'date_of_birth',
                              'staticProjectLegalFactsPinnedToSource': True},
                    'knownGates': ['content_review', 'runtime_field_mapping', 'appendices',
                                   'signature_based_due_date', 'accessory_variants',
                                   'source_bound_lender_and_delivery_address',
                                   'seller_email_hyperlink_target']}
        if delivery_version:
            manifest['profileKey'] = 'dejvice-original-dob-delivery-v2'
            manifest['knownGates'] = [gate for gate in manifest['knownGates']
                                      if gate not in ['source_bound_lender_and_delivery_address', 'seller_email_hyperlink_target']]
            manifest['knownGates'].append('source_bound_lender_and_project_legal_facts')
        manifest_name = 'sbk-delivery-review-manifest.json' if delivery_version else f'{kind}-review-manifest.json'
        (out / manifest_name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
        print(f'{kind}: {len(slots)} exact slots, {len(values)} fields; all non-text structure and package parts preserved')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--rs-source', type=Path, required=True)
    parser.add_argument('--sbk-source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--sbk-delivery-version', action='store_true')
    args = parser.parse_args()
    if args.sbk_delivery_version:
        parameterize('sbk', args.sbk_source, args.out, delivery_version=True)
    else:
        parameterize('rs', args.rs_source, args.out)
        parameterize('sbk', args.sbk_source, args.out)
