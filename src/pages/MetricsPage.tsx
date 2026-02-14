import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useMetrics } from '../hooks/useMetrics';
import { clearFirebaseConfig } from '../lib/firebase';
import { api } from '../lib/api';
import { getCookie, setCookie } from '../lib/cookies';
import type { Metric, GraphInterval } from '../types';
import { Header } from '../components/Header';
import { XPDisplay } from '../components/XPDisplay';
import { MetricsDashboard } from '../components/MetricsDashboard';
import { AddMetricForm } from '../components/AddMetricForm';
import { UpdateHistory } from '../components/UpdateHistory';
import { EditMetricModal } from '../components/EditMetricModal';
import { GraphModal } from '../components/GraphModal';

export function MetricsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout } = useAuth();
  const { isDark } = useDarkMode();
  const {
    metrics, updates, xp, rank, loading: metricsLoading,
    formulaWarnings,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  } = useMetrics(user);

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

  const handleCreateMarket = async (metricName: string, targetDate: string) => {
    if (!user) return;
    const metric = metrics.find(m => m.name === metricName);
    if (!metric) return;
    if (!confirm(`Create a market for "${metricName}" on ${targetDate}?`)) return;
    await api.createMarket(user, metric.id, targetDate);
  };

  const handleAddMetric = async (name: string, description: string, value: number, formula: string) => {
    await addMetric(name, description, value, formula);
  };

  const handleSaveEdit = async (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string
  ) => {
    await editMetric(id, name, description, value, formula, oldValue, updateNote);
  };

  if (authLoading || !user) {
    return <div className="loading">Loading...</div>;
  }

  if (metricsLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <>
      <Header
        onLogout={handleLogout}
        onReconfigure={handleReconfigure}
        graphInterval={graphInterval}
        onIntervalChange={handleIntervalChange}
      />
      <div className="container">
        <XPDisplay xp={xp} rank={rank} />
        <MetricsDashboard
          metrics={metrics}
          formulaWarnings={formulaWarnings}
          focusedMetricId={focusedMetricId}
          onToggleFocus={toggleFocus}
          onGraph={setGraphMetric}
          onEdit={setEditingMetric}
          onDelete={handleDelete}
          onCreateMarket={handleCreateMarket}
        />
        <AddMetricForm onAdd={handleAddMetric} />
        <UpdateHistory updates={updates} />
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
        loadLogs={loadMetricLogs}
        onClose={() => setGraphMetric(null)}
      />
    </>
  );
}
