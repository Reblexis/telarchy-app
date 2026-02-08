import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RootRedirect } from './pages/RootRedirect';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { MetricsPage } from './pages/MetricsPage';

export function App() {
  return (
    <BrowserRouter basename="/metrics-tracker">
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
