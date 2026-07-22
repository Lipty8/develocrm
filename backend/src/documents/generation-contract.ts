/** Future port only: no DOCX generation is performed until templates are approved. */
export type GenerateContractDocumentCommand = {
  tenantId: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  templateId: string;
  outputName: string;
  actorMembershipId: string;
};

export type GeneratedDocumentReference = {
  documentId: string;
  documentVersionId: string;
  contractDocumentLinkId: string;
  externalDriveId: string;
  externalItemId: string;
};

export interface ContractDocumentGenerationPort {
  generate(command: GenerateContractDocumentCommand): Promise<GeneratedDocumentReference>;
}
