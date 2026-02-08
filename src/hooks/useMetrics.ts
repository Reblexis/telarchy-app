import { useState, useEffect, useCallback } from 'react';
import {
  getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  query, orderBy, where, Timestamp, getDoc, setDoc, writeBatch,
} from 'firebase/firestore';
import { initializeFirebaseApp } from '../lib/firebase';
import {
  recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank,
  getAffectedMetrics, detectCircularDependency, calculateDaysPassed,
} from '../lib/metrics-engine';
import { getCookie, setCookie, deleteCookie } from '../lib/cookies';
import type { Metric, MetricLog, UpdateEntry } from '../types';

function getDb() {
  const app = initializeFirebaseApp();
  return getFirestore(app);
}

export function useMetrics(isAuthenticated: boolean) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [updates, setUpdates] = useState<UpdateEntry[]>([]);
  const [focusedMetricId, setFocusedMetricId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const xp = calculateXP(metrics);
  const rank = calculateRank(xp);

  const loadMetrics = useCallback(async () => {
    const db = getDb();
    const querySnapshot = await getDocs(collection(db, 'metrics'));
    const loaded: Metric[] = [];
    querySnapshot.forEach((d) => {
      const data = d.data();
      loaded.push({
        id: d.id,
        name: data.name,
        description: data.description || '',
        value: data.value,
        total: data.value,
        formula: data.formula || '0',
        decay: data.decay || false,
        order: data.order || 999,
        depth: 0,
      });
    });

    recalculateMetrics(loaded);

    const depths = calculateMetricDepths(loaded);
    loaded.forEach(m => {
      m.depth = depths[m.id] || 0;
    });

    loaded.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (a.order || 999) - (b.order || 999);
    });

    setMetrics(loaded);
    return loaded;
  }, []);

  const loadUpdates = useCallback(async () => {
    const db = getDb();
    const q = query(collection(db, 'updates'), orderBy('timestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    const list: UpdateEntry[] = [];
    querySnapshot.forEach((d) => {
      const data = d.data();
      list.push({
        metricName: data.metricName,
        oldValue: data.oldValue,
        newValue: data.newValue,
        description: data.description,
        timestamp: data.timestamp.toDate(),
      });
    });
    setUpdates(list);
  }, []);

  const logSpecificMetrics = useCallback(async (metricIds: string[], currentMetrics: Metric[]) => {
    const db = getDb();
    for (const metricId of metricIds) {
      const metric = currentMetrics.find(m => m.id === metricId);
      if (metric) {
        await addDoc(collection(db, 'metricLogs'), {
          metricId: metric.id,
          metricName: metric.name,
          value: metric.total,
          timestamp: Timestamp.now(),
        });
      }
    }
  }, []);

  const applyDecay = useCallback(async () => {
    const db = getDb();
    const lastDecayRef = doc(db, 'system', 'lastDecay');
    const lastDecayDoc = await getDoc(lastDecayRef);

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (!lastDecayDoc.exists()) {
      await setDoc(lastDecayRef, { lastDecayDate: today, timestamp: Timestamp.now() });
      return null;
    }

    const lastDecayDate = lastDecayDoc.data().lastDecayDate;
    const daysPassed = calculateDaysPassed(lastDecayDate, now);

    if (daysPassed > 0) {
      const metricsSnapshot = await getDocs(collection(db, 'metrics'));
      const batch = writeBatch(db);
      const decayedMetricIds: string[] = [];

      metricsSnapshot.forEach((metricDoc) => {
        const data = metricDoc.data();
        if (data.decay === true) {
          const newValue = Math.max(0, data.value - daysPassed);
          batch.update(metricDoc.ref, { value: newValue });
          decayedMetricIds.push(metricDoc.id);
        }
      });

      if (decayedMetricIds.length > 0) {
        await batch.commit();
        await addDoc(collection(db, 'updates'), {
          metricName: 'Automatic Daily Decay',
          oldValue: 0,
          newValue: -daysPassed,
          description: `Automatic decay: ${daysPassed} day${daysPassed > 1 ? 's' : ''} passed since last visit (${decayedMetricIds.length} metrics affected)`,
          timestamp: Timestamp.now(),
        });
      }

      await setDoc(lastDecayRef, { lastDecayDate: today, timestamp: Timestamp.now() });
      return decayedMetricIds.length > 0 ? decayedMetricIds : null;
    }

    return null;
  }, []);

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) return;

    (async () => {
      setLoading(true);
      const decayedIds = await applyDecay();
      const loaded = await loadMetrics();
      if (decayedIds && decayedIds.length > 0) {
        const affected = getAffectedMetrics(decayedIds, loaded);
        await logSpecificMetrics(affected, loaded);
      }
      await loadUpdates();

      const savedFocus = getCookie('focusedMetricId');
      if (savedFocus && loaded.find(m => m.id === savedFocus)) {
        setFocusedMetricId(savedFocus);
      } else if (savedFocus) {
        deleteCookie('focusedMetricId');
      }
      setLoading(false);
    })();
  }, [isAuthenticated, applyDecay, loadMetrics, loadUpdates, logSpecificMetrics]);

  const addMetric = async (name: string, description: string, value: number, formula: string, decay: boolean) => {
    if (detectCircularDependency(null, formula, metrics)) {
      throw new Error('This formula would create a circular dependency!');
    }
    const db = getDb();
    const docRef = await addDoc(collection(db, 'metrics'), {
      name, value, formula, description, decay, order: 999,
    });
    const loaded = await loadMetrics();
    const affected = getAffectedMetrics([docRef.id], loaded);
    await logSpecificMetrics(affected, loaded);
  };

  const editMetric = async (
    id: string, name: string, description: string, value: number,
    formula: string, decay: boolean, oldValue: number, updateNote: string
  ) => {
    if (detectCircularDependency(id, formula, metrics)) {
      throw new Error('This formula would create a circular dependency!');
    }
    const db = getDb();
    await updateDoc(doc(db, 'metrics', id), { name, description, value, formula, decay });

    if (oldValue !== value) {
      await addDoc(collection(db, 'updates'), {
        metricName: name,
        oldValue,
        newValue: value,
        description: updateNote || 'Value updated',
        timestamp: Timestamp.now(),
      });
    }

    const loaded = await loadMetrics();
    const affected = getAffectedMetrics([id], loaded);
    await logSpecificMetrics(affected, loaded);
    await loadUpdates();
  };

  const removeMetric = async (id: string) => {
    const db = getDb();
    if (focusedMetricId === id) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    }
    await deleteDoc(doc(db, 'metrics', id));
    await loadMetrics();
  };

  const toggleFocus = (metricId: string) => {
    if (focusedMetricId === metricId) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    } else {
      setFocusedMetricId(metricId);
      setCookie('focusedMetricId', metricId);
    }
  };

  const loadMetricLogs = async (metricId: string): Promise<MetricLog[]> => {
    const db = getDb();
    const q = query(
      collection(db, 'metricLogs'),
      where('metricId', '==', metricId),
      orderBy('timestamp', 'asc')
    );
    const querySnapshot = await getDocs(q);
    const logs: MetricLog[] = [];
    querySnapshot.forEach((d) => {
      const data = d.data();
      logs.push({
        metricId: data.metricId,
        metricName: data.metricName,
        value: data.value,
        timestamp: data.timestamp.toDate(),
      });
    });
    return logs;
  };

  return {
    metrics, updates, xp, rank, loading,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  };
}
