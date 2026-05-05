/** API key management using localStorage */

const KEY_PREFIX = 'fm-editor-apikey-';
const PROVIDER_KEY = 'fm-editor-provider';
const MODEL_KEY = 'fm-editor-model';

export function getApiKey(providerId: string): string {
  return localStorage.getItem(`${KEY_PREFIX}${providerId}`) ?? '';
}

export function setApiKey(providerId: string, key: string): void {
  if (key) {
    localStorage.setItem(`${KEY_PREFIX}${providerId}`, key);
  } else {
    localStorage.removeItem(`${KEY_PREFIX}${providerId}`);
  }
}

export function getSelectedProvider(): string {
  return localStorage.getItem(PROVIDER_KEY) ?? 'anthropic';
}

export function setSelectedProvider(id: string): void {
  localStorage.setItem(PROVIDER_KEY, id);
}

export function getSelectedModel(): string {
  return localStorage.getItem(MODEL_KEY) ?? '';
}

export function setSelectedModel(model: string): void {
  localStorage.setItem(MODEL_KEY, model);
}
