import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RootRedirect } from './pages/RootRedirect';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { MetricsPage } from './pages/MetricsPage';
import { AgentsPage } from './pages/AgentsPage';
import { MarketsPage } from './pages/MarketsPage';

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/markets" element={<MarketsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
