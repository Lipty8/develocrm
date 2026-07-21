export type UserIdentity = {
  id: string;
  email: string;
  displayName: string;
};

export type WorkspaceMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
};

export type Session = {
  user: UserIdentity;
  workspace: WorkspaceMembership;
};
