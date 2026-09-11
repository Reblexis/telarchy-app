import { Navigate, useParams } from 'react-router-dom';
import { GUIDE_ALIASES, GuideIndex, OneGuide } from '../components/Guides';

/**
 * telarchy.com/guides: the human door to the guides the API serves at
 * /api/guides. The index and the guide themselves are components/Guides.tsx,
 * shared with the data room's Documentation tab; this module exports only
 * the page, because the lazy route loader types a page from its module.
 */
export function GuidesPage() {
  const { section } = useParams<{ section?: string }>();
  if (section && GUIDE_ALIASES[section]) return <Navigate to={`/guides/${GUIDE_ALIASES[section]}`} replace />;
  return section ? <OneGuide section={section} /> : <GuideIndex />;
}
