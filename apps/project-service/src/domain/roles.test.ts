import { describe, expect, it } from 'vitest';
import { grantableRoles, hasRole, REQUIRED_ROLE } from './roles.js';

describe('roles', () => {
  it('orders roles OWNER > ADMIN > MEMBER', () => {
    expect(hasRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasRole('ADMIN', 'OWNER')).toBe(false);
  });

  it('lets members edit tasks but not create projects or manage members', () => {
    expect(hasRole('MEMBER', REQUIRED_ROLE.editTasks)).toBe(true);
    expect(hasRole('MEMBER', REQUIRED_ROLE.createProject)).toBe(false);
    expect(hasRole('MEMBER', REQUIRED_ROLE.manageMembers)).toBe(false);
  });

  it('only lets privilege flow downward', () => {
    expect(grantableRoles('OWNER')).toEqual(['ADMIN', 'MEMBER']);
    expect(grantableRoles('ADMIN')).toEqual(['MEMBER']);
    expect(grantableRoles('MEMBER')).toEqual([]);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
      expect(grantableRoles(role)).not.toContain('OWNER');
    }
  });
});
