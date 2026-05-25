import type { Capability } from '../types';

// Capabilities that amount to privilege elevation: a participant who gains one
// can change who-can-do-what or destroy workspace data. Granting these should
// not happen on a single stray checkbox click, so the UI confirms first.
export const PRIVILEGED_CAPABILITIES: Capability[] = ['manage', 'manage_workspace'];

// Plain-language description of what each privileged capability lets a member
// do, used in the confirmation prompt so the operator knows what they grant.
export const CAPABILITY_GRANTS: Record<string, string> = {
  manage: 'approve and decline proposals, manage permission groups (including granting capabilities), and edit workspace settings',
  manage_workspace: 'delete the workspace, change its visibility, and configure market liquidity',
};

export function isPrivilegedCapability(cap: Capability): boolean {
  return PRIVILEGED_CAPABILITIES.includes(cap);
}

/** The privileged capabilities present in a group's capability list, preserving
 *  the canonical PRIVILEGED_CAPABILITIES order. */
export function privilegedCapabilitiesIn(caps: readonly string[] | undefined): Capability[] {
  if (!caps) return [];
  return PRIVILEGED_CAPABILITIES.filter(c => caps.includes(c));
}
