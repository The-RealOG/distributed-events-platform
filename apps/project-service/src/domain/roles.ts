export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

const RANK: Record<WorkspaceRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** Minimum role required for each operation. Kept deliberately coarse. */
export const REQUIRED_ROLE = {
  readWorkspace: 'MEMBER',
  manageMembers: 'ADMIN',
  createProject: 'ADMIN',
  readProject: 'MEMBER',
  editTasks: 'MEMBER',
  comment: 'MEMBER',
} as const satisfies Record<string, WorkspaceRole>;

export function hasRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return RANK[actual] >= RANK[required];
}

/**
 * Roles an actor may grant. Nobody grants OWNER through the API (ownership transfer is out of
 * scope), and admins cannot create peers, so privilege only flows downward.
 */
export function grantableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  switch (actor) {
    case 'OWNER':
      return ['ADMIN', 'MEMBER'];
    case 'ADMIN':
      return ['MEMBER'];
    case 'MEMBER':
      return [];
  }
}
