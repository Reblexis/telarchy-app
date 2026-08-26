/** A workspace pool's frozen rules, from the route params (docs/workspace-pools.md). */

import { useParams } from 'react-router-dom';
import { LegalPage } from './LegalPage';

export function PoolRulesPage() {
  const params = useParams();
  return <LegalPage document={`pools/${params.workspaceId ?? ''}/${params.month ?? ''}`} />;
}
