import type { Principal } from '@dpp/auth';
import type { Database } from '@dpp/database';
import { sql } from 'drizzle-orm';
import { requireProjectRole, requireWorkspaceRole } from '../../domain/access.js';
import { REQUIRED_ROLE } from '../../domain/roles.js';
import { notFound } from '../../http/errors.js';
import { iso } from '../../http/schemas.js';
import { insertProjectWithBoard, listProjectsInWorkspace, type ProjectRow } from './repository.js';
import type { BoardCache, CacheStatus } from './board-cache.js';
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
  constructor(
    private readonly db: Database,
    private readonly boardCache?: BoardCache,
  ) {}

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
   * Cache-aside board read (ADR-015). Authorization runs on EVERY request, before the cache is
   * consulted, so a cached board is never served to someone who may not read the project. The
   * cache is best effort: any Redis problem means "read PostgreSQL", never an error.
   */
  async getBoardCached(
    principal: Principal,
    projectId: string,
    options: { fresh?: boolean } = {},
  ): Promise<{ board: BoardDto; cache: CacheStatus }> {
    const { project } = await requireProjectRole(
      this.db,
      principal.userId,
      projectId,
      REQUIRED_ROLE.readProject,
    );
    if (!this.boardCache) return { board: await this.#loadBoard(project), cache: 'BYPASS' };
    if (options.fresh) {
      // Read-your-writes: never serve the cached value, but refresh it for everyone else.
      const generation = await this.boardCache.generationForRefresh(projectId);
      const board = await this.#loadBoard(project);
      if (generation !== undefined) await this.boardCache.write(projectId, generation, board);
      return { board, cache: generation === undefined ? 'BYPASS' : 'REFRESH' };
    }
    const cached = await this.boardCache.read(projectId);
    if (cached.status === 'hit') return { board: cached.value, cache: 'HIT' };
    const board = await this.#loadBoard(project);
    // Only after a clean miss: the write-back is refused if an invalidation happened meanwhile.
    if (cached.status === 'miss') await this.boardCache.write(projectId, cached.generation, board);
    return { board, cache: cached.status === 'miss' ? 'MISS' : 'BYPASS' };
  }

  async getBoard(principal: Principal, projectId: string): Promise<BoardDto> {
    const { project } = await requireProjectRole(
      this.db,
      principal.userId,
      projectId,
      REQUIRED_ROLE.readProject,
    );
    return this.#loadBoard(project);
  }

  /**
   * The board aggregate (board, columns, active tasks, assignees) in ONE statement. A single
   * statement reads one snapshot, so a concurrent move can never make a task appear in two
   * columns or vanish from the response, without an explicit REPEATABLE READ transaction. It is
   * one statement rather than several queries because query building was the largest share of
   * this service's CPU under load; this form measured about 22 % less CPU per request.
   */
  async #loadBoard(project: ProjectRow): Promise<BoardDto> {
    const { rows } = await this.db.execute<{ board: BoardJson | null }>(sql`
      SELECT (
        SELECT json_build_object(
          'id', b.id,
          'name', b.name,
          'columns', coalesce((
            SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'position', c.position::text)
                            ORDER BY c.position, c.id)
            FROM board_columns c WHERE c.board_id = b.id), '[]'::json),
          'tasks', coalesce((
            SELECT json_agg(json_build_object(
                     'id', t.id, 'projectId', t.project_id, 'columnId', t.column_id, 'title', t.title,
                     'description', t.description, 'position', t.position::text, 'version', t.version,
                     'createdBy', t.created_by, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
                     'assigneeIds', coalesce((
                       SELECT json_agg(a.user_id ORDER BY a.created_at)
                       FROM task_assignees a WHERE a.task_id = t.id), '[]'::json))
                   ORDER BY t.position, t.id)
            FROM tasks t WHERE t.project_id = b.project_id AND t.deleted_at IS NULL), '[]'::json))
        FROM boards b WHERE b.project_id = ${project.id}
      ) AS board
    `);
    const found = rows[0]?.board;
    if (!found) throw notFound('Board');
    // Same wire format as before: ISO timestamps with millisecond precision.
    const isoMs = (value: string) => new Date(value).toISOString();
    return {
      project: toProjectDto(project),
      board: { id: found.id, name: found.name },
      columns: found.columns.map((column) => ({
        id: column.id,
        name: column.name,
        position: column.position,
        tasks: found.tasks
          .filter((task) => task.columnId === column.id)
          .map((task) => ({
            ...task,
            createdAt: isoMs(task.createdAt),
            updatedAt: isoMs(task.updatedAt),
          })),
      })),
    };
  }
}

interface BoardJson {
  id: string;
  name: string;
  columns: { id: string; name: string; position: string }[];
  tasks: {
    id: string;
    projectId: string;
    columnId: string;
    title: string;
    description: string;
    position: string;
    version: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    assigneeIds: string[];
  }[];
}
