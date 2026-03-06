import type { Principal } from '@dpp/auth';
import type { Database } from '@dpp/database';
import { requireProjectRole, requireWorkspaceRole } from '../../domain/access.js';
import { REQUIRED_ROLE } from '../../domain/roles.js';
import { notFound } from '../../http/errors.js';
import { iso } from '../../http/schemas.js';
import { listActiveTasksForProject, listAssigneeIds } from '../tasks/repository.js';
import { toTaskDto } from '../tasks/service.js';
import {
  findBoardWithColumns,
  insertProjectWithBoard,
  listProjectsInWorkspace,
  type ProjectRow,
} from './repository.js';
import type { BoardDto, ProjectDto } from './schemas.js';

export const toProjectDto = (row: ProjectRow): ProjectDto => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  description: row.description,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export class ProjectService {
  constructor(private readonly db: Database) {}

  async create(
    principal: Principal,
    input: { workspaceId: string; name: string; description: string },
  ): Promise<ProjectDto> {
    return this.db.transaction(async (tx) => {
      await requireWorkspaceRole(
        tx,
        principal.userId,
        input.workspaceId,
        REQUIRED_ROLE.createProject,
      );
      const project = await insertProjectWithBoard(tx, { ...input, createdBy: principal.userId });
      return toProjectDto(project);
    });
  }

  async get(principal: Principal, projectId: string): Promise<ProjectDto> {
    const { project } = await requireProjectRole(
      this.db,
      principal.userId,
      projectId,
      REQUIRED_ROLE.readProject,
    );
    return toProjectDto(project);
  }

  async listInWorkspace(principal: Principal, workspaceId: string): Promise<ProjectDto[]> {
    await requireWorkspaceRole(this.db, principal.userId, workspaceId, REQUIRED_ROLE.readWorkspace);
    return (await listProjectsInWorkspace(this.db, workspaceId)).map(toProjectDto);
  }

  /**
   * The board aggregate is assembled from several queries; a read-only REPEATABLE READ
   * transaction makes them observe one snapshot, so a concurrent move can never make a task
   * appear in two columns or vanish from the response.
   */
  async getBoard(principal: Principal, projectId: string): Promise<BoardDto> {
    return this.db.transaction(
      async (tx) => {
        const { project } = await requireProjectRole(
          tx,
          principal.userId,
          projectId,
          REQUIRED_ROLE.readProject,
        );
        const found = await findBoardWithColumns(tx, projectId);
        if (!found) throw notFound('Board');
        const taskRows = await listActiveTasksForProject(tx, projectId);
        const assignees = await listAssigneeIds(
          tx,
          taskRows.map((t) => t.id),
        );

        return {
          project: toProjectDto(project),
          board: { id: found.board.id, name: found.board.name },
          columns: found.columns.map((column) => ({
            id: column.id,
            name: column.name,
            position: column.position,
            tasks: taskRows
              .filter((task) => task.columnId === column.id)
              .map((task) => toTaskDto(task, assignees.get(task.id) ?? [])),
          })),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
