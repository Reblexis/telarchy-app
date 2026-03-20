/** Returns the correct post-login path based on the user's profile. */
export function postLoginPath(profile: { authRole?: string; intent?: string | null }): string {
  if (profile.authRole !== 'pending') return '/metrics';
  return profile.intent === 'agent' ? '/agents' : '/create-workspace';
}
