import type { Principal } from '@dpp/auth';
import { PG_UNIQUE_VIOLATION, pgErrorCode, type Database } from '@dpp/database';
import { requireWorkspaceRole } from '../../domain/access.js';
import { grantableRoles, REQUIRED_ROLE, type WorkspaceRole } from '../../domain/roles.js';
import { conflict, forbidden, notFound } from '../../http/errors.js';
import { iso } from '../../http/schemas.js';
import { findUserByEmail } from '../identity/repository.js';
import {
  insertMember,
  insertWorkspace,
  listMembers,
  listWorkspacesForUser,
  type WorkspaceRow,
} from './repository.js';
import type { MemberDto, WorkspaceDto } from './schemas.js';

const toWorkspaceDto = (row: WorkspaceRow, role: WorkspaceRole): WorkspaceDto => ({
  id: row.id,
  name: row.name,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  role,
});

export class WorkspaceService {
  constructor(private readonly db: Database) {}

  async create(principal: Principal, name: string): Promise<WorkspaceDto> {
    return this.db.transaction(async (tx) => {
      const workspace = await insertWorkspace(tx, { name, createdBy: principal.userId });
      await insertMember(tx, {
        workspaceId: workspace.id,
        userId: principal.userId,
        role: 'OWNER',
      });
      return toWorkspaceDto(workspace, 'OWNER');
    });
  }

  async list(principal: Principal): Promise<WorkspaceDto[]> {
    const rows = await listWorkspacesForUser(this.db, principal.userId);
    return rows.map((row) => toWorkspaceDto(row.workspace, row.role));
  }

  async get(principal: Principal, workspaceId: string): Promise<WorkspaceDto> {
    const { workspace, role } = await requireWorkspaceRole(
      this.db,
      principal.userId,
      workspaceId,
      REQUIRED_ROLE.readWorkspace,
    );
    return toWorkspaceDto(workspace, role);
  }

  async listMembers(principal: Principal, workspaceId: string): Promise<MemberDto[]> {
    await requireWorkspaceRole(this.db, principal.userId, workspaceId, REQUIRED_ROLE.readWorkspace);
    const rows = await listMembers(this.db, workspaceId);
    return rows.map((row) => ({ ...row, joinedAt: iso(row.joinedAt) }));
  }

  async addMember(
    principal: Principal,
    workspaceId: string,
    input: { email: string; role: WorkspaceRole },
  ): Promise<MemberDto> {
    return this.db.transaction(async (tx) => {
      const { role: actorRole } = await requireWorkspaceRole(
        tx,
        principal.userId,
        workspaceId,
        REQUIRED_ROLE.manageMembers,
      );
      if (!grantableRoles(actorRole).includes(input.role)) {
        throw forbidden(`A ${actorRole} cannot grant the ${input.role} role`);
      }
      const user = await findUserByEmail(tx, input.email.toLowerCase());
      if (!user) throw notFound('User');

      try {
        await insertMember(tx, { workspaceId, userId: user.id, role: input.role });
      } catch (err) {
        if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
          throw conflict('User is already a member of this workspace');
        }
        throw err;
      }
      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: input.role,
        joinedAt: new Date().toISOString(),
      };
    });
  }
}
