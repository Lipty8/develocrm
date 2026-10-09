#!/usr/bin/env python3
"""Create the first parameterized Rezidence Dejvice RS template.

The source file stays untouched.  Only text nodes in word/document.xml are
changed; styles, numbering, headers, footers, relationships and attachments
are copied byte-for-byte.
"""

from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.iter(f"{W}t"))


def replace_paragraph(paragraph: ET.Element, value: str) -> None:
    nodes = list(paragraph.iter(f"{W}t"))
    if not nodes:
        raise RuntimeError(f"Paragraph has no text nodes: {paragraph_text(paragraph)!r}")
    nodes[0].text = value
    for node in nodes[1:]:
        node.text = ""
    for run in paragraph.iter(f"{W}r"):
        properties = run.find(f"{W}rPr")
        if properties is None:
            continue
        for tag in (f"{W}highlight", f"{W}shd"):
            for decoration in list(properties.findall(tag)):
                properties.remove(decoration)


def replace_unique(root: ET.Element, needle: str, value: str) -> None:
    matches = [p for p in root.iter(f"{W}p") if needle in paragraph_text(p)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one paragraph containing {needle!r}, found {len(matches)}")
    replace_paragraph(matches[0], value)


def keep_with_next_unique(root: ET.Element, needle: str) -> None:
    matches = [p for p in root.iter(f"{W}p") if needle in paragraph_text(p)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one paragraph containing {needle!r}, found {len(matches)}")
    properties = matches[0].find(f"{W}pPr")
    if properties is None:
        properties = ET.Element(f"{W}pPr")
        matches[0].insert(0, properties)
    if properties.find(f"{W}keepNext") is None:
        properties.append(ET.Element(f"{W}keepNext"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    replacements = {
        "(1)Rezidence Dejvice 2 s.r.o.": "(1)\t{{seller.name}}",
        "se sídlem Rohanské nábřeží": "se sídlem {{seller.address}};",
        "zapsaná v\u00a0Obchodním rejstříku": "{{seller.registryEntry}};",
        "IČ: 241 06 119": "IČ: {{seller.registrationNumber}};",
        "zastoupená jednatelem": "zastoupená {{seller.representative}};",
        "jaroslav.zahourek@immobuilding.cz": "{{seller.email}};",
        "Datová schránka: nymania": "Datová schránka: {{seller.dataBox}}",
        "178\u00a0412 7011\u00a0/ 2700": "{{seller.bankAccount}};",
        "(2)Paní/ Pan": "(2)\t{{buyer.salutation}} {{buyer.name}}",
        "Bytem": "Bytem\t\t\t{{buyer.address}}",
        "RČ": "Datum narození\t\t{{buyer.birthDate}}",
        "Email ": "Email \t\t\t{{buyer.email}}",
        "Tel": "Tel\t\t\t{{buyer.phone}}",
        "Datová schránka……………………": "{{buyer.dataBoxLine}}",
        "Investor hodlá na Pozemku realizovat projekt": "Investor hodlá na Pozemku realizovat projekt „{{project.name}}“ (dále jen „Projekt“), v jehož rámci bude postaven bytový dům (dále také jen „Dům“), který je navržen jako dům o pěti nadzemních podlažích s celkem cca 19 byty; jedním podzemním podlažím s celkem cca 25 parkovacími stáními v podzemní garáži; cca 19 sklepy, umístěnými v 1PP či v 1NP Domu; a 4 venkovními parkovacími stáními.",
        "Zájemce bere na vědomí záměr Investora dokončit": "Zájemce bere na vědomí záměr Investora dokončit výstavbu Projektu v roce {{project.completionYear}}.",
        "Investor se zavazuje po dobu 30": "Investor se zavazuje po dobu {{contract.reservationPeriodDays}} kalendářních dnů od podpisu této smlouvy (dále jen „Rezervační doba“) rezervovat pro Zájemce Předmět rezervace vymezený níže v čl. II a Zájemce se touto smlouvou zavazuje, že za podmínek stanovených v této smlouvě uzavře během této doby s Investorem Budoucí smlouvu. Termín „rezervovat“ užitý v tomto odstavci rezervační smlouvy znamená závazek Investora nenabízet (ať již osobně či zprostředkovaně) níže uvedený Předmět rezervace k prodeji, pronájmu či k jinému užití třetí straně (avšak vyjma takové nabídky, ze které bude zřejmá existence rezervace Předmětu rezervace a možnost uzavření smlouvy s dalším zájemcem až po skončení platnosti této rezervace), ani Předmět rezervace neprodat, nepronajmout či k němu nezřídit žádné právo užití ve prospěch třetí strany, to vše po Rezervační dobu.",
        "Jednotky č. …": "{{unit.subjectClause}}",
        "k\u00a0terase/ balkonu": "{{unit.balconyClause}}",
        "předzahrádce, to je části": "{{unit.gardenClause}}",
        "venkovní parkovací stání č.": "{{unit.outdoorParkingClause}}",
        "Jednotky č. S…": "{{unit.cellarClause}}",
        "Garáže – spoluvlastnického podílu": "{{unit.garageClause}}",
        "Zájemce se tímto zavazuje, že do 3 pracovních dnů": "{{payment.reservationFeeClause}}",
        "Smluvní strany se zavazují uzavřít Budoucí smlouvu v Rezervační době": "Smluvní strany se zavazují uzavřít Budoucí smlouvu v Rezervační době, tedy do {{contract.reservationPeriodDays}} kalendářních dnů od podpisu této smlouvy, za podmínek uvedených dále v čl. IV. odst. 2. této smlouvy a v přílohách této smlouvy.",
        "Cena za Předmět rezervace byla sjednána": "{{contract.totalPriceClause}}",
        "V Praze dne ……………": "V Praze dne {{contract.date}}\t\t\tV Praze dne {{contract.date}}",
    }

    with zipfile.ZipFile(args.source, "r") as source_zip:
        package = {name: source_zip.read(name) for name in source_zip.namelist()}
    for _, namespace in ET.iterparse(io.BytesIO(package["word/document.xml"]), events=("start-ns",)):
        prefix, uri = namespace
        ET.register_namespace(prefix, uri)
    root = ET.fromstring(package["word/document.xml"])
    for needle, value in replacements.items():
        replace_unique(root, needle, value)
    # Keep the two short closing clauses of Article III together. Without this,
    # Word can place only the list marker for clause 4 at the bottom of page 2.
    keep_with_next_unique(root, "Smluvní strany se zavazují uzavřít Budoucí smlouvu")
    for properties in root.iter(f"{W}rPr"):
        for decoration in list(properties.findall(f"{W}highlight")):
            properties.remove(decoration)
    for properties in root.iter(f"{W}pPr"):
        run_properties = properties.find(f"{W}rPr")
        if run_properties is not None:
            for decoration in list(run_properties.findall(f"{W}highlight")):
                run_properties.remove(decoration)
    package["word/document.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as output_zip:
        for name, data in package.items():
            output_zip.writestr(name, data)


if __name__ == "__main__":
    main()
