import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from '@re/validation';
import {
  resolveEffectivePermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  canReadLead,
} from '../rbac';

describe('resolveEffectivePermissions', () => {
  it('unions role permissions and grants', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['leads.update'],
      grants: ['leads.export'],
    });
    expect(hasPermission(eff, 'leads.update')).toBe(true);
    expect(hasPermission(eff, 'leads.export')).toBe(true);
  });

  it('revocation wins over role and grant', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['leads.merge'],
      grants: ['leads.merge'],
      revocations: ['leads.merge'],
    });
    expect(hasPermission(eff, 'leads.merge')).toBe(false);
  });

  it('expands read-scope implications (all → team → assigned)', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['leads.read.all'] });
    expect(hasPermission(eff, 'leads.read.all')).toBe(true);
    expect(hasPermission(eff, 'leads.read.team')).toBe(true);
    expect(hasPermission(eff, 'leads.read.assigned')).toBe(true);
  });

  it('does not grant an implied scope that is explicitly revoked', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['leads.read.all'],
      revocations: ['leads.read.assigned'],
    });
    expect(hasPermission(eff, 'leads.read.team')).toBe(true);
    expect(hasPermission(eff, 'leads.read.assigned')).toBe(false);
  });

  it('private conversation read implies assigned conversation read', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: ['conversations.read.private'],
    });
    expect(hasPermission(eff, 'conversations.read.assigned')).toBe(true);
  });
});

describe('default role bundles', () => {
  it('project_maintenance CANNOT read private conversations', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: DEFAULT_ROLE_PERMISSIONS.project_maintenance,
    });
    expect(hasPermission(eff, 'conversations.read.private')).toBe(false);
    expect(hasPermission(eff, 'conversations.read.assigned')).toBe(false);
    // but it CAN manage projects/inventory/knowledge
    expect(
      hasAllPermissions(eff, ['projects.manage', 'inventory.manage', 'knowledge.approve']),
    ).toBe(true);
  });

  it('sales_agent is limited to assigned leads', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: DEFAULT_ROLE_PERMISSIONS.sales_agent,
    });
    expect(hasPermission(eff, 'leads.read.assigned')).toBe(true);
    expect(hasPermission(eff, 'leads.read.all')).toBe(false);
    expect(hasPermission(eff, 'leads.read.team')).toBe(false);
  });

  it('viewer holds no mutation permissions', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: DEFAULT_ROLE_PERMISSIONS.viewer,
    });
    const mutations: PermissionKey[] = [
      'leads.update',
      'leads.merge',
      'projects.manage',
      'inventory.manage',
      'scoring.publish',
      'pipeline.move',
      'conversations.reply',
    ];
    expect(hasAnyPermission(eff, mutations)).toBe(false);
  });

  it('super_admin holds no tenant-data permissions by default', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: DEFAULT_ROLE_PERMISSIONS.super_admin,
    });
    expect(hasPermission(eff, 'platform.tenants.create')).toBe(true);
    expect(hasAnyPermission(eff, ['leads.read.all', 'conversations.read.private'])).toBe(false);
  });

  it('client_admin can publish scoring and read private conversations', () => {
    const eff = resolveEffectivePermissions({
      rolePermissions: DEFAULT_ROLE_PERMISSIONS.client_admin,
    });
    expect(hasAllPermissions(eff, ['scoring.publish', 'conversations.read.private'])).toBe(true);
  });
});

describe('canReadLead', () => {
  const assigned = ['agent-1', 'agent-2'];

  it('leads.read.all reads any lead', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['leads.read.all'] });
    expect(canReadLead({ effective: eff, profileId: 'someone', assignedAgentIds: assigned })).toBe(
      true,
    );
  });

  it('assigned-only agent reads only their assigned leads', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['leads.read.assigned'] });
    expect(canReadLead({ effective: eff, profileId: 'agent-1', assignedAgentIds: assigned })).toBe(
      true,
    );
    expect(canReadLead({ effective: eff, profileId: 'agent-9', assignedAgentIds: assigned })).toBe(
      false,
    );
  });

  it('no read permission denies access', () => {
    const eff = resolveEffectivePermissions({ rolePermissions: ['leads.update'] });
    expect(canReadLead({ effective: eff, profileId: 'agent-1', assignedAgentIds: assigned })).toBe(
      false,
    );
  });
});
