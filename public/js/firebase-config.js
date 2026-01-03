const STORAGE_KEY = 'metricsTrackerFirebaseConfig';

export function getFirebaseConfig() {
  const configStr = localStorage.getItem(STORAGE_KEY);
  if (!configStr) return null;
  
  return JSON.parse(configStr);
}

export function saveFirebaseConfig(config) {
  const requiredFields = ['apiKey', 'authDomain', 'projectId'];
  
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return true;
}

export function clearFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function initializeFirebaseApp() {
  const config = getFirebaseConfig();
  
  if (!config) {
    throw new Error('Firebase config not found. Please configure your Firebase project first.');
  }
  
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
  return initializeApp(config);
}


