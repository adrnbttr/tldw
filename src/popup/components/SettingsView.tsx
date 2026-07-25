import { useEffect, useState } from 'preact/hooks';
import type { DetailLevel, Settings } from '@/types';
import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '@/types';
import { getSettings, saveSettings } from '@/storage';

interface Props {
  onClose: () => void;
}

const DETAIL_LEVELS: Array<{ value: DetailLevel; label: string }> = [
  { value: 'concise', label: 'Concis' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Détaillé' },
];

export function SettingsView({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onClose}>
          ← Retour
        </button>
        <h1>Paramètres</h1>
      </header>

      <label class="field">
        <span>Clé API OpenRouter</span>
        <input
          type="password"
          value={settings.openRouterKey}
          placeholder="sk-or-..."
          onInput={(e) => update('openRouterKey', (e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span>Clé API transcription (fallback audio)</span>
        <input
          type="password"
          value={settings.transcriptionKey}
          placeholder="optionnelle"
          onInput={(e) => update('transcriptionKey', (e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span>Modèle de résumé</span>
        <select
          value={settings.summaryModel}
          onChange={(e) => update('summaryModel', (e.target as HTMLSelectElement).value)}
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.note ? ` — ${m.note}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Langue de sortie</span>
        <input
          type="text"
          value={settings.outputLanguage}
          onInput={(e) => update('outputLanguage', (e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span>Niveau de détail</span>
        <select
          value={settings.detailLevel}
          onChange={(e) =>
            update('detailLevel', (e.target as HTMLSelectElement).value as DetailLevel)
          }
        >
          {DETAIL_LEVELS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <button class="primary" onClick={() => void save()}>
        {saved ? 'Enregistré ✓' : 'Enregistrer'}
      </button>
    </div>
  );
}
