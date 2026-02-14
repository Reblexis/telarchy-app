import { initializeApp, FirebaseApp } from 'firebase/app';
import type { FirebaseConfig } from '../types';

const STORAGE_KEY = 'metricsTrackerFirebaseConfig';

export function getFirebaseConfig(): FirebaseConfig | null {
  const envConfig = import.meta.env.VITE_FIREBASE_CONFIG;
  if (envConfig) {
    const config: FirebaseConfig = JSON.parse(atob(envConfig));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  }
  const configStr = localStorage.getItem(STORAGE_KEY);
  if (!configStr) return null;
  return JSON.parse(configStr);
}

export function getConfigFromURL(): FirebaseConfig | null {
  const urlParams = new URLSearchParams(window.location.search);
  const configParam = urlParams.get('config');
  if (!configParam) return null;

  const configJson = atob(configParam);
  const config: FirebaseConfig = JSON.parse(configJson);
  return config;
}

export function saveFirebaseConfig(config: FirebaseConfig): void {
  const requiredFields: (keyof FirebaseConfig)[] = ['apiKey', 'authDomain', 'projectId'];
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearFirebaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

let app: FirebaseApp | null = null;

export function initializeFirebaseApp(): FirebaseApp {
  if (app) return app;
  const config = getFirebaseConfig();
  if (!config) {
    throw new Error('Firebase config not found.');
  }
  app = initializeApp(config);
  return app;
}
