import { initializeFirebaseApp, clearFirebaseConfig } from '/js/firebase-config.js';
import { toggleDarkMode, isDarkMode } from '/js/dark-mode.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, orderBy, where, Timestamp, getDoc, setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = await initializeFirebaseApp();
const auth = getAuth(app);
const db = getFirestore(app);

let currentMetrics = [];
let currentEditId = null;
let focusedMetricId = null;

function setCookie(name, value, days = 365) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/';
}

const loading = document.getElementById('loading');
const metricsContent = document.getElementById('metricsContent');
const logoutBtn = document.getElementById('logoutBtn');
const reconfigureBtn = document.getElementById('reconfigureBtn');
const darkModeToggle = document.getElementById('darkModeToggle');
const graphSensitivity = document.getElementById('graphSensitivity');
const xpValue = document.getElementById('xpValue');
const rankValue = document.getElementById('rankValue');
const metricsGrid = document.getElementById('metricsGrid');
const timeline = document.getElementById('timeline');
const addMetricForm = document.getElementById('addMetricForm');
const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const modalClose = document.getElementById('modalClose');
const graphModal = document.getElementById('graphModal');
const graphModalClose = document.getElementById('graphModalClose');
const graphModalTitle = document.getElementById('graphModalTitle');
const graphModalContainer = document.getElementById('graphModalContainer');

let currentEditOldValue = null;

function updateDarkModeIcon() {
  darkModeToggle.textContent = isDarkMode() ? '☀️' : '🌙';
}

function getGraphSensitivity() {
  return getCookie('graphSensitivity') || 'day';
}

function setGraphSensitivity(sensitivity) {
  setCookie('graphSensitivity', sensitivity);
}

updateDarkModeIcon();

const savedSensitivity = getGraphSensitivity();
graphSensitivity.value = savedSensitivity;

graphSensitivity.addEventListener('change', () => {
  setGraphSensitivity(graphSensitivity.value);
});

function calculateXP(metrics) {
  const utilityMetric = metrics.find(m => m.name === 'Utility');
  return utilityMetric ? utilityMetric.total : 0;
}

function calculateRank(xp) {
  if (xp >= 900) return 'S';
  if (xp >= 800) return 'A';
  if (xp >= 700) return 'B';
  if (xp >= 600) return 'C';
  if (xp >= 500) return 'D';
  if (xp >= 400) return 'E';
  return '-';
}

function alignTimestamp(date, sensitivity) {
  const aligned = new Date(date);
  
  aligned.setMilliseconds(0);
  
  if (sensitivity === 'second') {
    return aligned;
  }
  
  aligned.setSeconds(0);
  
  if (sensitivity === 'minute') {
    return aligned;
  }
  
  aligned.setMinutes(0);
  
  if (sensitivity === 'hour') {
    return aligned;
  }
  
  aligned.setHours(0);
  
  if (sensitivity === 'day') {
    return aligned;
  }
  
  if (sensitivity === 'week') {
    const day = aligned.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    aligned.setDate(aligned.getDate() + diff);
    return aligned;
  }
  
  aligned.setDate(1);
  
  if (sensitivity === 'month') {
    return aligned;
  }
  
  aligned.setMonth(0);
  return aligned;
}

function generateSamplePoints(startDate, endDate, sensitivity) {
  const samples = [];
  const current = alignTimestamp(startDate, sensitivity);
  const end = endDate.getTime();
  
  while (current.getTime() <= end) {
    samples.push(new Date(current));
    
    if (sensitivity === 'second') {
      current.setSeconds(current.getSeconds() + 1);
    } else if (sensitivity === 'minute') {
      current.setMinutes(current.getMinutes() + 1);
    } else if (sensitivity === 'hour') {
      current.setHours(current.getHours() + 1);
    } else if (sensitivity === 'day') {
      current.setDate(current.getDate() + 1);
    } else if (sensitivity === 'week') {
      current.setDate(current.getDate() + 7);
    } else if (sensitivity === 'month') {
      current.setMonth(current.getMonth() + 1);
    } else if (sensitivity === 'year') {
      current.setFullYear(current.getFullYear() + 1);
    }
  }
  
  return samples;
}

function getValueAtTime(logs, sampleTime) {
  const sampleMs = sampleTime.getTime();
  
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].timestamp.getTime() <= sampleMs) {
      return logs[i].value;
    }
  }
  
  return null;
}

async function logMetricValue(metricId, metricName, value) {
  await addDoc(collection(db, 'metricLogs'), {
    metricId,
    metricName,
    value: Number(value),
    timestamp: Timestamp.now()
  });
}

async function loadMetricLogs(metricId) {
  const q = query(
    collection(db, 'metricLogs'),
    where('metricId', '==', metricId),
    orderBy('timestamp', 'asc')
  );
  const querySnapshot = await getDocs(q);
  const logs = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    logs.push({
      timestamp: data.timestamp.toDate(),
      value: data.value
    });
  });
  return logs;
}

let currentGraphChart = null;

window.openGraphModal = async function(metricId, metricName) {
  graphModalTitle.textContent = `${metricName} - Progress Graph`;
  graphModal.classList.add('show');
  graphModalContainer.innerHTML = '<div class="graph-loading">Loading graph...</div>';
  
  const logs = await loadMetricLogs(metricId);
  
  if (logs.length === 0) {
    graphModalContainer.innerHTML = '<div class="graph-no-data">No data yet. Values will be logged as they change.</div>';
    return;
  }
  
  const sensitivity = getGraphSensitivity();
  const samplePoints = generateSamplePoints(logs[0].timestamp, logs[logs.length - 1].timestamp, sensitivity);
  
  const sampledData = [];
  for (const sampleTime of samplePoints) {
    const value = getValueAtTime(logs, sampleTime);
    if (value !== null) {
      sampledData.push({
        x: sampleTime.getTime(),
        y: value
      });
    }
  }
  
  if (sampledData.length === 0) {
    graphModalContainer.innerHTML = '<div class="graph-no-data">No data available for the selected time range.</div>';
    return;
  }
  
  graphModalContainer.innerHTML = '<canvas id="graphModalCanvas"></canvas>';
  const canvas = document.getElementById('graphModalCanvas');
  
  if (currentGraphChart) {
    currentGraphChart.destroy();
  }
  
  const ctx = canvas.getContext('2d');
  
  const darkMode = isDarkMode();
  const lineColor = darkMode ? '#60a5fa' : '#1a73e8';
  const fillColor = darkMode ? 'rgba(96, 165, 250, 0.2)' : 'rgba(26, 115, 232, 0.1)';
  const gridColor = darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  const textColor = darkMode ? '#b0b0b0' : '#666';
  
  currentGraphChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Value',
        data: sampledData,
        borderColor: lineColor,
        backgroundColor: fillColor,
        tension: 0.3,
        fill: true,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: lineColor,
        pointBorderColor: darkMode ? '#1a1a1a' : '#ffffff',
        pointBorderWidth: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.5,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: darkMode ? '#2a2a2a' : '#ffffff',
          titleColor: darkMode ? '#e0e0e0' : '#1a1a1a',
          bodyColor: darkMode ? '#b0b0b0' : '#4a4a4a',
          borderColor: darkMode ? '#3a3a3a' : '#e0e0e0',
          borderWidth: 1,
          callbacks: {
            title: function(context) {
              const date = new Date(context[0].parsed.x);
              return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          grid: {
            color: gridColor
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            font: {
              size: 11
            },
            color: textColor,
            callback: function(value) {
              const date = new Date(value);
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
          }
        },
        y: {
          beginAtZero: false,
          grid: {
            color: gridColor
          },
          ticks: {
            color: textColor
          }
        }
      }
    }
  });
}

function evaluateFormula(formula, metricsMap) {
  if (!formula || formula.trim() === '0' || formula.trim() === '') {
    return 0;
  }
  
  let expression = formula;
  const metricRefs = formula.match(/\{([^}]+)\}/g);
  
  if (metricRefs) {
    for (const ref of metricRefs) {
      const metricName = ref.slice(1, -1).trim();
      const metric = metricsMap[metricName];
      if (metric) {
        expression = expression.replace(ref, metric.total);
      } else {
        expression = expression.replace(ref, '0');
      }
    }
  }
  
  expression = expression.replace(/sqrt\(/g, 'Math.sqrt(');
  expression = expression.replace(/abs\(/g, 'Math.abs(');
  expression = expression.replace(/min\(/g, 'Math.min(');
  expression = expression.replace(/max\(/g, 'Math.max(');
  expression = expression.replace(/pow\(/g, 'Math.pow(');
  
  const result = eval(expression);
  return isNaN(result) ? 0 : result;
}

function extractMetricReferences(formula) {
  if (!formula) return [];
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).trim());
}

function getAffectedMetrics(changedMetricIds) {
  const nameToId = {};
  const idToMetric = {};
  currentMetrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });
  
  const dependents = {};
  currentMetrics.forEach(m => {
    dependents[m.id] = [];
  });
  
  currentMetrics.forEach(metric => {
    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depId = nameToId[depName];
      if (depId) {
        dependents[depId].push(metric.id);
      }
    });
  });
  
  const affected = new Set(changedMetricIds);
  const queue = [...changedMetricIds];
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    const deps = dependents[currentId] || [];
    
    for (const depId of deps) {
      if (!affected.has(depId)) {
        affected.add(depId);
        queue.push(depId);
      }
    }
  }
  
  return Array.from(affected);
}

function getDependencyChain(metricId) {
  const nameToId = {};
  const idToMetric = {};
  currentMetrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });
  
  const chain = new Set([metricId]);
  
  const children = getAffectedMetrics([metricId]);
  children.forEach(id => chain.add(id));
  
  const visited = new Set();
  function addParents(currentId) {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    
    const metric = idToMetric[currentId];
    if (metric && metric.formula) {
      const deps = extractMetricReferences(metric.formula);
      deps.forEach(depName => {
        const depId = nameToId[depName];
        if (depId) {
          chain.add(depId);
          addParents(depId);
        }
      });
    }
  }
  
  addParents(metricId);
  
  return Array.from(chain);
}

function detectCircularDependency(metricId, formula, allMetrics) {
  const tempMetrics = allMetrics.map(m => 
    m.id === metricId ? { ...m, formula } : m
  );
  
  const nameToId = {};
  const idToMetric = {};
  tempMetrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });
  
  const dependencies = extractMetricReferences(formula);
  for (const depName of dependencies) {
    const depId = nameToId[depName];
    if (depId === metricId) return true;
  }
  
  const visited = new Set();
  const recStack = new Set();
  
  function hasCycle(currentId) {
    if (recStack.has(currentId)) return true;
    if (visited.has(currentId)) return false;
    
    visited.add(currentId);
    recStack.add(currentId);
    
    const current = idToMetric[currentId];
    if (current && current.formula) {
      const deps = extractMetricReferences(current.formula);
      for (const depName of deps) {
        const depId = nameToId[depName];
        if (depId && hasCycle(depId)) {
          return true;
        }
      }
    }
    
    recStack.delete(currentId);
    return false;
  }
  
  return hasCycle(metricId);
}

function topologicalSort(metrics) {
  const nameToMetric = {};
  metrics.forEach(m => {
    nameToMetric[m.name] = m;
  });
  
  const sorted = [];
  const visited = new Set();
  const temp = new Set();
  
  function visit(metric) {
    if (temp.has(metric.id)) return;
    if (visited.has(metric.id)) return;
    
    temp.add(metric.id);
    
    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depMetric = nameToMetric[depName];
      if (depMetric) {
        visit(depMetric);
      }
    });
    
    temp.delete(metric.id);
    visited.add(metric.id);
    sorted.push(metric);
  }
  
  metrics.forEach(metric => {
    if (!visited.has(metric.id)) {
      visit(metric);
    }
  });
  
  return sorted;
}

function recalculateMetrics(metrics) {
  const sorted = topologicalSort(metrics);
  const nameToMetric = {};
  
  sorted.forEach(m => {
    nameToMetric[m.name] = m;
  });
  
  sorted.forEach(metric => {
    const formulaResult = evaluateFormula(metric.formula || '0', nameToMetric);
    metric.total = metric.value + formulaResult;
  });
  
  return metrics;
}

function calculateMetricDepths(metrics) {
  const nameToMetric = {};
  const idToMetric = {};
  metrics.forEach(m => {
    nameToMetric[m.name] = m;
    idToMetric[m.id] = m;
  });
  
  const dependents = {};
  metrics.forEach(m => {
    dependents[m.id] = [];
  });
  
  metrics.forEach(metric => {
    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depMetric = nameToMetric[depName];
      if (depMetric) {
        dependents[depMetric.id].push(metric.id);
      }
    });
  });
  
  const depths = {};
  const visited = new Set();
  
  function getDepth(metricId) {
    if (depths[metricId] !== undefined) {
      return depths[metricId];
    }
    
    if (visited.has(metricId)) {
      return 0;
    }
    
    visited.add(metricId);
    
    const deps = dependents[metricId] || [];
    if (deps.length === 0) {
      depths[metricId] = 0;
    } else {
      let minDepth = Infinity;
      for (const depId of deps) {
        const depDepth = getDepth(depId);
        minDepth = Math.min(minDepth, depDepth + 1);
      }
      depths[metricId] = minDepth;
    }
    
    visited.delete(metricId);
    return depths[metricId];
  }
  
  metrics.forEach(metric => {
    getDepth(metric.id);
  });
  
  return depths;
}

function calculateDaysPassed(lastDate, currentDate) {
  const last = new Date(lastDate);
  const current = new Date(currentDate);
  
  last.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  
  return Math.floor((current - last) / (1000 * 60 * 60 * 24));
}

async function applyDecay() {
  const lastDecayRef = doc(db, 'system', 'lastDecay');
  const lastDecayDoc = await getDoc(lastDecayRef);
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (!lastDecayDoc.exists()) {
    await setDoc(lastDecayRef, {
      lastDecayDate: today,
      timestamp: Timestamp.now()
    });
    return false;
  }
  
  const lastDecayDate = lastDecayDoc.data().lastDecayDate;
  const daysPassed = calculateDaysPassed(lastDecayDate, now);
  
  if (daysPassed > 0) {
    const metricsSnapshot = await getDocs(collection(db, 'metrics'));
    const batch = writeBatch(db);
    
    const decayedMetricIds = [];
    metricsSnapshot.forEach((metricDoc) => {
      const data = metricDoc.data();
      if (data.decay === true) {
        const currentValue = data.value;
        const newValue = Math.max(0, currentValue - daysPassed);
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
        timestamp: Timestamp.now()
      });
      
      console.log(`Applied -${daysPassed} decay to ${decayedMetricIds.length} metric${decayedMetricIds.length > 1 ? 's' : ''}`);
      
      await setDoc(lastDecayRef, {
        lastDecayDate: today,
        timestamp: Timestamp.now()
      });
      
      return decayedMetricIds;
    }
    
    await setDoc(lastDecayRef, {
      lastDecayDate: today,
      timestamp: Timestamp.now()
    });
  }
  
  return false;
}

async function loadMetrics() {
  const querySnapshot = await getDocs(collection(db, 'metrics'));
  currentMetrics = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    currentMetrics.push({ 
      id: doc.id, 
      ...data,
      formula: data.formula || '0',
      decay: data.decay || false
    });
  });
  
  recalculateMetrics(currentMetrics);
  
  const depths = calculateMetricDepths(currentMetrics);
  currentMetrics.forEach(m => {
    m.depth = depths[m.id] || 0;
  });
  
  currentMetrics.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return (a.order || 999) - (b.order || 999);
  });
  
  const xp = calculateXP(currentMetrics);
  xpValue.textContent = xp.toFixed(2);
  rankValue.textContent = calculateRank(xp);
  
  const savedFocusedId = getCookie('focusedMetricId');
  if (savedFocusedId && currentMetrics.find(m => m.id === savedFocusedId)) {
    focusedMetricId = savedFocusedId;
  } else if (savedFocusedId) {
    deleteCookie('focusedMetricId');
  }
  
  renderMetrics();
}

async function logSpecificMetrics(metricIds) {
  for (const metricId of metricIds) {
    const metric = currentMetrics.find(m => m.id === metricId);
    if (metric) {
      await logMetricValue(metric.id, metric.name, metric.total);
    }
  }
}

function renderMetrics() {
  let metricsToRender = currentMetrics;
  let focusBanner = '';
  
  if (focusedMetricId) {
    const chain = getDependencyChain(focusedMetricId);
    metricsToRender = currentMetrics.filter(m => chain.includes(m.id));
    
    const focusedMetric = currentMetrics.find(m => m.id === focusedMetricId);
    if (focusedMetric) {
      focusBanner = `
        <div class="focus-banner">
          <div class="focus-banner-text">
            Focus Mode: <strong>${focusedMetric.name}</strong>
          </div>
          <button class="focus-exit-btn" onclick="toggleFocusMode('${focusedMetricId}')">Exit Focus Mode</button>
        </div>
      `;
    }
  }
  
  const groupedByDepth = {};
  metricsToRender.forEach(metric => {
    const depth = metric.depth || 0;
    if (!groupedByDepth[depth]) {
      groupedByDepth[depth] = [];
    }
    groupedByDepth[depth].push(metric);
  });
  
  const depths = Object.keys(groupedByDepth).map(Number).sort((a, b) => a - b);
  
  const metricsContent = depths.map(depth => {
    const metrics = groupedByDepth[depth];
    const cards = metrics.map(metric => {
      const hasFormula = metric.formula && metric.formula !== '0';
      const formulaResult = metric.total - metric.value;
      return `
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-name">${metric.name}</div>
          ${metric.description ? `<div class="metric-stats" style="margin-bottom: 0.25rem; font-style: italic;">${metric.description}</div>` : ''}
          <div class="metric-stats">Base: ${metric.value.toFixed(2)} | Total: ${metric.total.toFixed(2)} | Decay: ${metric.decay ? 'ON' : 'OFF'}</div>
          ${hasFormula ? `<details style="margin-top: 0.5rem;">
            <summary>Formula (+${formulaResult.toFixed(2)})</summary>
            <div>${metric.formula}</div>
          </details>` : ''}
        </div>
        <div class="metric-actions">
          <button class="btn-small btn-focus ${focusedMetricId === metric.id ? 'active' : ''}" onclick="toggleFocusMode('${metric.id}')" title="Focus on this metric">Zoom</button>
          <button class="btn-small" onclick="openGraphModal('${metric.id}', '${metric.name}')">Graph</button>
          <button class="btn-small" onclick="editMetric('${metric.id}')">Edit</button>
          <button class="btn-small btn-delete" onclick="deleteMetric('${metric.id}')">Delete</button>
        </div>
      </div>
    `;
    }).join('');
    
    return `
      <div class="depth-group" style="margin-bottom: 2rem;">
        <div style="font-size: 0.75rem; color: #999; margin-bottom: 0.5rem; font-weight: 500;">Level ${depth}</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">
          ${cards}
        </div>
      </div>
    `;
  }).join('');
  
  metricsGrid.innerHTML = focusBanner + metricsContent;
}

window.editMetric = function(id) {
  const metric = currentMetrics.find(m => m.id === id);
  if (!metric) return;
  
  currentEditId = id;
  currentEditOldValue = metric.value;
  document.getElementById('editName').value = metric.name;
  document.getElementById('editDescription').value = metric.description || '';
  document.getElementById('editValue').value = metric.value;
  document.getElementById('editFormula').value = metric.formula || '0';
  document.getElementById('editDecay').checked = metric.decay || false;
  document.getElementById('editUpdateNote').value = '';
  editModal.classList.add('show');
};

window.toggleFocusMode = function(metricId) {
  if (focusedMetricId === metricId) {
    focusedMetricId = null;
    deleteCookie('focusedMetricId');
  } else {
    focusedMetricId = metricId;
    setCookie('focusedMetricId', metricId);
  }
  renderMetrics();
};

window.deleteMetric = async function(id) {
  if (!confirm('Are you sure you want to delete this metric?')) return;
  
  if (focusedMetricId === id) {
    focusedMetricId = null;
    deleteCookie('focusedMetricId');
  }
  
  await deleteDoc(doc(db, 'metrics', id));
  await loadMetrics();
};

async function addMetric(name, value, formula = '0', description = '', decay = false, order = 999) {
  const docRef = await addDoc(collection(db, 'metrics'), {
    name,
    value: Number(value),
    formula,
    description,
    decay,
    order
  });
  return docRef.id;
}

async function loadUpdateHistory() {
  const q = query(collection(db, 'updates'), orderBy('timestamp', 'desc'));
  const querySnapshot = await getDocs(q);
  
  const updates = [];
  querySnapshot.forEach((doc) => {
    updates.push(doc.data());
  });
  
  timeline.innerHTML = updates.length === 0 
    ? '<p style="color: #999;">No updates yet</p>'
    : updates.map(update => {
        const date = update.timestamp.toDate();
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const change = update.newValue - update.oldValue;
        const changeStr = change > 0 ? `+${change}` : change;
        
        return `
          <div class="timeline-item">
            <div class="timeline-header">
              <div>
                <span class="timeline-metric">${update.metricName}</span>
                <span class="timeline-change">${update.oldValue} → ${update.newValue} (${changeStr})</span>
              </div>
              <div class="timeline-date">${dateStr}</div>
            </div>
            <div class="timeline-description">${update.description}</div>
          </div>
        `;
      }).join('');
}

addMetricForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('metricName').value;
  const description = document.getElementById('metricDescription').value;
  const value = document.getElementById('metricValue').value;
  const formula = document.getElementById('metricFormula').value || '0';
  const decay = document.getElementById('metricDecay').checked;
  
  if (detectCircularDependency(null, formula, currentMetrics)) {
    alert('Error: This formula would create a circular dependency!');
    return;
  }
  
  const newMetricId = await addMetric(name, value, formula, description, decay);
  await loadMetrics();
  const affectedMetrics = getAffectedMetrics([newMetricId]);
  await logSpecificMetrics(affectedMetrics);
  
  addMetricForm.reset();
  document.getElementById('metricFormula').value = '0';
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('editName').value;
  const description = document.getElementById('editDescription').value;
  const value = document.getElementById('editValue').value;
  const formula = document.getElementById('editFormula').value || '0';
  const decay = document.getElementById('editDecay').checked;
  const updateNote = document.getElementById('editUpdateNote').value;
  
  if (detectCircularDependency(currentEditId, formula, currentMetrics)) {
    alert('Error: This formula would create a circular dependency!');
    return;
  }
  
  const editedMetricId = currentEditId;
  const newValue = Number(value);
  const valueChanged = currentEditOldValue !== newValue;
  
  await updateDoc(doc(db, 'metrics', currentEditId), {
    name,
    description,
    value: newValue,
    formula,
    decay
  });
  
  if (valueChanged) {
    await addDoc(collection(db, 'updates'), {
      metricName: name,
      oldValue: Number(currentEditOldValue),
      newValue: newValue,
      description: updateNote || 'Value updated',
      timestamp: Timestamp.now()
    });
  }
  
  await loadMetrics();
  const affectedMetrics = getAffectedMetrics([editedMetricId]);
  await logSpecificMetrics(affectedMetrics);
  await loadUpdateHistory();
  editModal.classList.remove('show');
  currentEditId = null;
  currentEditOldValue = null;
});

modalClose.addEventListener('click', () => {
  editModal.classList.remove('show');
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) {
    editModal.classList.remove('show');
  }
});

graphModalClose.addEventListener('click', () => {
  graphModal.classList.remove('show');
  if (currentGraphChart) {
    currentGraphChart.destroy();
    currentGraphChart = null;
  }
});

graphModal.addEventListener('click', (e) => {
  if (e.target === graphModal) {
    graphModal.classList.remove('show');
    if (currentGraphChart) {
      currentGraphChart.destroy();
      currentGraphChart = null;
    }
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = '/';
});

reconfigureBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to reconfigure Firebase? This will log you out and clear your Firebase configuration. Your data will remain in your Firebase project.')) {
    clearFirebaseConfig();
    await signOut(auth);
    window.location.href = '/setup.html';
  }
});

darkModeToggle.addEventListener('click', () => {
  toggleDarkMode();
  updateDarkModeIcon();
});

onAuthStateChanged(auth, async (user) => {
  loading.style.display = 'none';
  
  if (user) {
    metricsContent.style.display = 'block';
    const decayedMetricIds = await applyDecay();
    await loadMetrics();
    if (decayedMetricIds && decayedMetricIds.length > 0) {
      const affectedMetrics = getAffectedMetrics(decayedMetricIds);
      await logSpecificMetrics(affectedMetrics);
    }
    await loadUpdateHistory();
  } else {
    window.location.href = '/login.html';
  }
});

