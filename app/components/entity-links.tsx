'use client';
import type {ReactNode} from 'react';
import Link from 'next/link';
import {units} from '../crm-data';
import {relatedUnitHref,type UnitReference} from '../lib/entity-navigation';

export function RelatedUnitLink({reference,children,className}:{reference:UnitReference;children:ReactNode;className?:string}){
  const href=relatedUnitHref(reference,units);
  return href?<Link className={className} href={href} onClick={event=>event.stopPropagation()}>{children}</Link>:<span className={className} aria-disabled="true" title="Jednotka není v tomto přehledu dostupná">{children}</span>;
}
