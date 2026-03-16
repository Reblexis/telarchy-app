import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useMetrics } from '../hooks/useMetrics';
import { clearFirebaseConfig } from '../lib/firebase';
import { getCookie, setCookie } from '../lib/cookies';
import type { Metric, GraphInterval } from '../types';
import { useInspectMode } from '../hooks/useInspectMode';
import { Header } from '../components/Header';
import { DarkModeToggle } from '../components/DarkModeToggle';
import { XPDisplay } from '../components/XPDisplay';
import { MetricsDashboard } from '../components/MetricsDashboard';
import { AddMetricForm } from '../components/AddMetricForm';
import { EditMetricModal } from '../components/EditMetricModal';
import { GraphModal } from '../components/GraphModal';

export function MetricsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark } = useDarkMode();
  const { inspectTask } = useInspectMode();
  const {
    metrics, xp, rank, loading: metricsLoading, error,
    formulaWarnings,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  } = useMetrics(user, inspectTask?.id);

  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [graphMetric, setGraphMetric] = useState<Metric | null>(null);
  const [graphInterval, setGraphInterval] = useState<GraphInterval>(
    () => (getCookie('graphInterval') as GraphInterval) || 'day'
  );

  const handleIntervalChange = (interval: GraphInterval) => {
    setGraphInterval(interval);
    setCookie('graphInterval', interval);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleReconfigure = async () => {
    if (confirm('Are you sure you want to reconfigure Firebase? This will log you out and clear your Firebase configuration. Your data will remain in your Firebase project.')) {
      clearFirebaseConfig();
      await logout();
      navigate('/setup');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this metric?')) {
      await removeMetric(id);
    }
  };

  const handleAddMetric = async (name: string, description: string, value: number, formula: string, marketRangeMax?: number) => {
    await addMetric(name, description, value, formula, marketRangeMax);
  };

  const handleSaveEdit = async (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference: import('../types').TimePreference | null,
    marketRangeMax?: number,
  ) => {
    await editMetric(id, name, description, value, formula, oldValue, updateNote, timePreference, marketRangeMax);
  };

  if (!user || metricsLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="login-page">
        <div className="container" style={{ maxWidth: 520 }}>
          <h1>Access denied</h1>
          <div className="error show">{error}</div>
          <p style={{ color: 'var(--text-secondary)' }}>
            This browser account signed in successfully, but the backend did not authorize it for admin access.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button onClick={handleLogout}>Logout</button>
            <button onClick={handleReconfigure}>Reconfigure Firebase</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header activePage="metrics" actions={<>
        <select id="graphInterval" title="Graph time interval" value={graphInterval}
          onChange={e => handleIntervalChange(e.target.value as GraphInterval)}>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
        <DarkModeToggle />
        <button className="reconfigure-btn" onClick={handleReconfigure}>⚙️</button>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </>} />
      <div className="container">
        <XPDisplay xp={xp} rank={rank} />
        <MetricsDashboard
          metrics={metrics}
          isInspectMode={!!inspectTask}
          formulaWarnings={formulaWarnings}
          focusedMetricId={focusedMetricId}
          onToggleFocus={toggleFocus}
          onGraph={setGraphMetric}
          onEdit={setEditingMetric}
          onDelete={handleDelete}
        />
        <AddMetricForm onAdd={handleAddMetric} />
      </div>
      <EditMetricModal
        metric={editingMetric}
        onClose={() => setEditingMetric(null)}
        onSave={handleSaveEdit}
      />
      <GraphModal
        metric={graphMetric}
        interval={graphInterval}
        isDark={isDark}
        isInspectMode={!!inspectTask}
        loadLogs={loadMetricLogs}
        onClose={() => setGraphMetric(null)}
      />
    </>
  );
}
