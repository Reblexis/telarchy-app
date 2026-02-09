import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey && apiKey === process.env.API_KEY) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) return next();
    return res.status(401).json({ error: 'Invalid token' });
  }

  return res.status(401).json({ error: 'Unauthorized' });
}
