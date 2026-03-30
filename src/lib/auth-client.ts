import { createAuthClient } from 'better-auth/react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  basePath: '/api/auth',
});
