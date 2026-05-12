import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMetrics } from '../hooks/useMetrics';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Metric } from '../types';
import { useInspectMode } from '../hooks/useInspectMode';
import { MetricsDashboard } from '../components/MetricsDashboard';
import { AddMetricGhostCard } from '../components/AddMetricGhostCard';
import { EditMetricModal } from '../components/EditMetricModal';
import { GraphModal } from '../components/GraphModal';
import { InspectIndicator } from '../components/InspectIndicator';

export function MetricsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { inspectProposal } = useInspectMode();
  const { workspace } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';
  const {
    metrics, loading: metricsLoading, error,
    formulaWarnings,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  } = useMetrics(!!user, inspectProposal?.id, isAdmin);

  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [graphMetric, setGraphMetric] = useState<Metric | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const target = searchParams.get('focus');
    if (!target || metricsLoading) return;
    if (!metrics.find(m => m.id === target)) return;
    if (focusedMetricId !== target) toggleFocus(target);
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
    requestAnimationFrame(() => {
      const el = document.getElementById(`metric-${target}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, metrics, metricsLoading]);
  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this metric?')) {
      await removeMetric(id);
    }
  };

  const showWarnings = (warnings: string[]) => {
    if (warnings.length > 0) alert(warnings.join('\n'));
  };

  const handleAddMetric = async (name: string, description: string, value: number, formula: string, marketRangeMax?: number) => {
    const warnings = await addMetric(name, description, value, formula, marketRangeMax);
    showWarnings(warnings);
  };

  const handleSaveEdit = async (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference: import('../types').TimePreference | null,
    marketRangeMax?: number,
  ) => {
    const warnings = await editMetric(id, name, description, value, formula, oldValue, updateNote, timePreference, marketRangeMax);
    if (warnings) showWarnings(warnings);
  };

  const handleInlineValueChange = async (metric: import('../types').Metric, newValue: number) => {
    await editMetric(metric.id, metric.name, metric.description || '', newValue, metric.formula || '0', metric.value, '', metric.timePreference ?? null, metric.marketRangeMax);
  };


  if (!user || metricsLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="login-page">
        <div className="container" style={{ maxWidth: 520 }}>
          <h1>Error loading workspace</h1>
          <div className="error show">{error}</div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="container">
        {inspectProposal && (
          <div style={{ marginBottom: '1rem' }}>
            <InspectIndicator />
          </div>
        )}
        {metrics.length === 0 && isAdmin && (
          <div style={{
            padding: '2rem',
            background: 'var(--focus-bg)',
            border: '1px solid var(--focus-border)',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Your workspace is empty</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              What do you want to track? Enable time preference to get market predictions.
            </p>
            <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
              <AddMetricGhostCard onAdd={handleAddMetric} autoFocus />
            </div>
          </div>
        )}
        <MetricsDashboard
          metrics={metrics}
          isInspectMode={!!inspectProposal}
          formulaWarnings={formulaWarnings}
          focusedMetricId={focusedMetricId}
          onToggleFocus={toggleFocus}
          onGraph={setGraphMetric}
          onEdit={isAdmin ? setEditingMetric : undefined}
          onDelete={isAdmin ? handleDelete : undefined}
          onValueChange={isAdmin ? handleInlineValueChange : undefined}
          onAddMetric={isAdmin ? handleAddMetric : undefined}
        />
      </div>
      <EditMetricModal
        metric={editingMetric}
        onClose={() => setEditingMetric(null)}
        onSave={handleSaveEdit}
      />
      <GraphModal
        metric={graphMetric}
        interval="day"
        isInspectMode={!!inspectProposal}
        loadLogs={loadMetricLogs}
        onClose={() => setGraphMetric(null)}
      />
    </>
  );
}
