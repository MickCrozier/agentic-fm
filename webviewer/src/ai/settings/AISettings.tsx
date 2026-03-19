import { useState, useEffect } from 'preact/hooks';
import * as monaco from 'monaco-editor';
import { listProviders, getProvider } from '../providers/registry';
import { fetchSettings, saveSettings, fetchCustomInstructions, saveCustomInstructions } from '@/api/client';
import {
  THEME_PRESETS,
  LIGHT_PRESETS,
  loadSavedPresetId,
  loadSavedCustomColors,
  saveTheme,
  type ThemeColors,
} from '@/editor/language/themes';
import { importVSCodeTheme, importMonacoTheme } from '@/editor/language/theme-import';

interface AISettingsProps {
  onClose: () => void;
  onPresetChange?: (presetId: string) => void;
}

const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string; mbsVar: string }> = [
  { key: 'comments', label: 'Comments', mbsVar: '$comments' },
  { key: 'controlFlow', label: 'Control flow', mbsVar: '$logical' },
  { key: 'scriptSteps', label: 'Script steps', mbsVar: '$functions (steps)' },
  { key: 'variables', label: 'Variables', mbsVar: '$variables' },
  { key: 'globals', label: 'Globals', mbsVar: '$globals' },
  { key: 'fields', label: 'Fields', mbsVar: '$fields' },
  { key: 'strings', label: 'Strings', mbsVar: '$strings' },
  { key: 'functions', label: 'Formula functions', mbsVar: '$functions + $environment' },
  { key: 'constants', label: 'Constants', mbsVar: '$environment' },
  { key: 'numbers', label: 'Numbers', mbsVar: '$numbers' },
  { key: 'operators', label: 'Operators', mbsVar: '$operators' },
  { key: 'brackets', label: 'Brackets', mbsVar: '$brackets' },
];

export function AISettings({ onClose, onPresetChange }: AISettingsProps) {
  const providers = listProviders();
  const [providerId, setProviderId] = useState('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setKey] = useState('');
  const [promptMarker, setPromptMarker] = useState('prompt');
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // Editor / theme state
  const [presetId, setPresetId] = useState('default_dark');
  const [customColors, setCustomColors] = useState<Partial<ThemeColors>>({});
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  // Load current settings from server
  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setProviderId(s.provider);
        setModel(s.model);
        setPromptMarker(s.promptMarker || 'prompt');
        setConfiguredProviders(s.configuredProviders);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
    fetchCustomInstructions().then(setCustomInstructions).catch(() => {});

    // Load theme settings from localStorage
    setPresetId(loadSavedPresetId());
    setCustomColors(loadSavedCustomColors());
  }, []);

  // Update model when provider changes
  useEffect(() => {
    const provider = getProvider(providerId);
    if (provider && (!model || !provider.models.includes(model))) {
      setModel(provider.defaultModel);
    }
  }, [providerId]);

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      const result = await saveSettings({ provider: providerId, model, promptMarker });

      if (apiKey) {
        const keyResult = await saveSettings({ apiKey, apiKeyProvider: providerId });
        setConfiguredProviders(keyResult.configuredProviders);
      } else {
        setConfiguredProviders(result.configuredProviders);
      }

      await saveCustomInstructions(customInstructions);

      setKey('');
      setStatus('Saved');
    } catch {
      setStatus('Error saving');
    } finally {
      setSaving(false);
    }
  };

  const handlePresetChange = (id: string) => {
    setPresetId(id);
    setCustomColors({});
    saveTheme(monaco, id, {});
    onPresetChange?.(id);
  };

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    const updated = { ...customColors, [key]: value };
    setCustomColors(updated);
    saveTheme(monaco, presetId, updated);
  };

  const handleResetToPreset = () => {
    setCustomColors({});
    saveTheme(monaco, presetId, {});
  };

  const handleImport = () => {
    setImportError('');
    try {
      let imported: Partial<ThemeColors>;
      // Try VS Code format first, then Monaco
      try {
        imported = importVSCodeTheme(importJson);
      } catch {
        imported = importMonacoTheme(importJson);
      }
      if (Object.keys(imported).length === 0) {
        setImportError('No recognizable color tokens found in the JSON.');
        return;
      }
      setCustomColors(imported);
      saveTheme(monaco, presetId, imported);
      setShowImport(false);
      setImportJson('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Failed to parse theme JSON.');
    }
  };

  const currentProvider = getProvider(providerId);
  const hasKey = configuredProviders.includes(providerId);
  const needsKey = currentProvider?.requiresKey !== false;

  // Compute effective colors for display
  const preset = THEME_PRESETS.find(p => p.id === presetId) ?? THEME_PRESETS[0];
  const effectiveColors = { ...preset.colors, ...customColors };

  if (loading) {
    return (
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-neutral-800 rounded-lg shadow-xl w-96 p-6 text-neutral-400 text-sm">
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-neutral-800 rounded-lg shadow-xl w-[420px] max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-700 sticky top-0 bg-neutral-800 z-10">
          <h2 class="text-sm font-semibold text-neutral-200">Settings</h2>
          <button onClick={onClose} class="text-neutral-400 hover:text-neutral-200 text-lg">&times;</button>
        </div>

        <div class="p-4 space-y-5">

          {/* === AI Section === */}
          <div>
            <h3 class="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">AI</h3>
            <div class="space-y-4">

              {/* Provider */}
              <div>
                <label class="block text-xs text-neutral-400 mb-1">Provider</label>
                <select
                  value={providerId}
                  onChange={(e) => setProviderId((e.target as HTMLSelectElement).value)}
                  class="w-full bg-neutral-700 text-neutral-200 text-sm rounded px-2 py-1.5 outline-none"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                      {p.requiresKey === false
                        ? ' (CLI)'
                        : configuredProviders.includes(p.id) ? ' (key set)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model */}
              <div>
                <label class="block text-xs text-neutral-400 mb-1">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel((e.target as HTMLSelectElement).value)}
                  class="w-full bg-neutral-700 text-neutral-200 text-sm rounded px-2 py-1.5 outline-none"
                >
                  {currentProvider?.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              {needsKey ? (
                <div>
                  <label class="block text-xs text-neutral-400 mb-1">
                    API Key
                    {hasKey && <span class="text-green-400 ml-1">(configured)</span>}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onInput={(e) => setKey((e.target as HTMLInputElement).value)}
                    placeholder={hasKey ? 'Enter new key to replace' : `Enter ${currentProvider?.displayName} API key`}
                    class="w-full bg-neutral-700 text-neutral-200 text-sm rounded px-2 py-1.5 outline-none placeholder:text-neutral-500"
                  />
                  <p class="text-xs text-neutral-500 mt-1">
                    Stored in <code>.env.local</code> on the server. Never sent to the browser.
                  </p>
                </div>
              ) : (
                <div class="bg-neutral-700/50 rounded px-3 py-2">
                  <p class="text-xs text-green-400">Uses your Claude Code login session</p>
                  <p class="text-xs text-neutral-500 mt-1">
                    No API key needed. Make sure you are logged in via <code>claude login</code>.
                  </p>
                </div>
              )}

              {/* Prompt Marker */}
              <div>
                <label class="block text-xs text-neutral-400 mb-1">Prompt marker keyword</label>
                <input
                  type="text"
                  value={promptMarker}
                  onInput={(e) => setPromptMarker((e.target as HTMLInputElement).value)}
                  placeholder="prompt"
                  class="w-full bg-neutral-700 text-neutral-200 text-sm rounded px-2 py-1.5 outline-none placeholder:text-neutral-500"
                />
                <p class="text-xs text-neutral-500 mt-1">
                  Script comments starting with <code># {promptMarker}:</code> are treated as AI instructions.
                </p>
              </div>

              {/* Custom Instructions */}
              <div>
                <label class="block text-xs text-neutral-400 mb-1">Custom instructions</label>
                <textarea
                  value={customInstructions}
                  onInput={(e) => setCustomInstructions((e.target as HTMLTextAreaElement).value)}
                  placeholder="Additional instructions injected into every AI request..."
                  rows={5}
                  class="w-full bg-neutral-700 text-neutral-200 text-xs rounded px-2 py-1.5 outline-none placeholder:text-neutral-500 font-mono resize-y"
                />
                <p class="text-xs text-neutral-500 mt-1">
                  Injected as "Developer Instructions" in the system prompt. Also editable at{' '}
                  <code>agent/config/.custom-instructions.md</code>.
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-neutral-700" />

          {/* === Editor Section === */}
          <div>
            <h3 class="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Editor</h3>
            <div class="space-y-4">

              {/* Theme preset */}
              <div>
                <label class="block text-xs text-neutral-400 mb-1">Theme</label>
                <select
                  value={presetId}
                  onChange={(e) => handlePresetChange((e.target as HTMLSelectElement).value)}
                  class="w-full bg-neutral-700 text-neutral-200 text-sm rounded px-2 py-1.5 outline-none"
                >
                  {THEME_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Color swatches */}
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs text-neutral-400">Token colors</label>
                  <button
                    onClick={handleResetToPreset}
                    class="text-xs text-neutral-500 hover:text-neutral-300 underline"
                  >
                    Reset to preset
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                  {COLOR_FIELDS.map(({ key, label, mbsVar }) => (
                    <div key={key} class="flex items-center gap-2">
                      <input
                        type="color"
                        value={effectiveColors[key]}
                        onInput={(e) => handleColorChange(key, (e.target as HTMLInputElement).value)}
                        class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        title={`MBS: ${mbsVar}`}
                      />
                      <span class="text-xs text-neutral-300 truncate" title={`MBS: ${mbsVar}`}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Import theme */}
              <div>
                <button
                  onClick={() => { setShowImport(!showImport); setImportError(''); }}
                  class="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  {showImport ? 'Cancel import' : 'Import theme (VS Code / Monaco JSON)'}
                </button>
                {showImport && (
                  <div class="mt-2 space-y-2">
                    <textarea
                      value={importJson}
                      onInput={(e) => setImportJson((e.target as HTMLTextAreaElement).value)}
                      placeholder={'Paste VS Code or Monaco theme JSON here...'}
                      rows={6}
                      class="w-full bg-neutral-900 text-neutral-200 text-xs rounded px-2 py-1.5 outline-none font-mono resize-none border border-neutral-600"
                    />
                    {importError && (
                      <p class="text-xs text-red-400">{importError}</p>
                    )}
                    <button
                      onClick={handleImport}
                      disabled={!importJson.trim()}
                      class="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
                    >
                      Apply imported colors
                    </button>
                    <p class="text-xs text-neutral-500">
                      Colors are mapped to the 12 token categories above. Fine-tune with the swatches after importing.
                    </p>
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>

        <div class="flex items-center justify-between px-4 py-3 border-t border-neutral-700 sticky bottom-0 bg-neutral-800">
          {status && (
            <span class={`text-xs ${status === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>
              {status}
            </span>
          )}
          <div class="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              class="px-3 py-1 rounded text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-300"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              class="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
