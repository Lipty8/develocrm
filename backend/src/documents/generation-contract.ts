/**
 * Boundary for approved contract generation. Implementations must render only
 * explicit, validated template fields and must never infer missing legal data.
 * The current rollout keeps this port disconnected until the approved RS/SBK/KS
 * templates are parameterized and the SharePoint permission grant is complete.
 */
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
