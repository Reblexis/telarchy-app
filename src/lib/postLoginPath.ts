/** Returns the correct post-login path based on the user's profile. */
export function postLoginPath(profile: { authRole?: string }): string {
  return profile.authRole === 'pending' ? '/create-workspace' : '/metrics';
}
