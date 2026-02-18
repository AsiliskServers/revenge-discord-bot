"use client";

import { useEffect, useMemo, useState } from "react";
import type { VoiceCreatorFeatureConfig } from "@/lib/types";

type ApiRecord = {
  guildId: string;
  featureKey: string;
  enabled: boolean;
  config: VoiceCreatorFeatureConfig;
  updatedAt: string;
};

type GuildMeta = {
  voiceChannels: Array<{ id: string; name: string }>;
  categoryChannels: Array<{ id: string; name: string }>;
  warning?: string;
};

type ApiGetPayload = {
  ok: boolean;
  data: ApiRecord;
  meta?: GuildMeta;
  error?: string;
};

type Props = {
  guildId: string;
};

type SaveMode = "toggle" | "save";

const DEFAULT_CONFIG: VoiceCreatorFeatureConfig = {
  creatorChannelId: "",
  targetCategoryId: "",
  emptyDeleteDelayMs: 5000,
  tempVoiceNamePrefix: "🔊・Salon de ",
};

function emptyMeta(): GuildMeta {
  return { voiceChannels: [], categoryChannels: [] };
}

export default function VoiceCreatorCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metaWarning, setMetaWarning] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<VoiceCreatorFeatureConfig>(DEFAULT_CONFIG);
  const [guildMeta, setGuildMeta] = useState<GuildMeta>(emptyMeta());

  function clearAlerts() {
    setError(null);
    setSuccess(null);
  }

  function applyRecord(data: ApiRecord) {
    setEnabled(Boolean(data.enabled));
    setConfig({
      creatorChannelId: data.config.creatorChannelId || "",
      targetCategoryId: data.config.targetCategoryId || "",
      emptyDeleteDelayMs: Number(data.config.emptyDeleteDelayMs) || 5000,
      tempVoiceNamePrefix: data.config.tempVoiceNamePrefix || "🔊・Salon de ",
    });
  }

  async function fetchRecord(): Promise<{ record: ApiRecord; meta: GuildMeta }> {
    const response = await fetch(`/api/features/voice-creator?guildId=${guildId}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiGetPayload;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Echec de chargement");
    }

    return {
      record: payload.data as ApiRecord,
      meta: payload.meta || emptyMeta(),
    };
  }

  async function load() {
    setLoading(true);
    clearAlerts();

    try {
      const { record, meta } = await fetchRecord();
      applyRecord(record);
      setGuildMeta(meta);
      setMetaWarning(meta.warning || null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [guildId]);

  const canSave = useMemo(() => {
    if (!config.creatorChannelId.trim() || !config.targetCategoryId.trim()) {
      return false;
    }

    const delay = Number(config.emptyDeleteDelayMs);
    if (!Number.isFinite(delay) || delay < 1000 || delay > 120000) {
      return false;
    }

    return config.tempVoiceNamePrefix.trim().length > 0;
  }, [config]);

  function updateConfig(patch: Partial<VoiceCreatorFeatureConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function getVoiceOptionsWithCurrent(currentId: string) {
    const base = guildMeta.voiceChannels;
    if (!currentId || base.some((channel) => channel.id === currentId)) {
      return base;
    }
    return [{ id: currentId, name: `Salon actuel (${currentId})` }, ...base];
  }

  function getCategoryOptionsWithCurrent(currentId: string) {
    const base = guildMeta.categoryChannels;
    if (!currentId || base.some((channel) => channel.id === currentId)) {
      return base;
    }
    return [{ id: currentId, name: `Categorie actuelle (${currentId})` }, ...base];
  }

  async function patchConfig(nextEnabled: boolean): Promise<ApiRecord> {
    const response = await fetch("/api/features/voice-creator", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId,
        enabled: nextEnabled,
        config,
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Echec de sauvegarde");
    }

    return payload.data as ApiRecord;
  }

  async function runSave(mode: SaveMode, nextEnabled: boolean) {
    const isToggle = mode === "toggle";
    if (loading || saving || toggling) {
      return false;
    }
    if (!isToggle && !canSave) {
      return false;
    }

    if (isToggle) {
      setToggling(true);
    } else {
      setSaving(true);
    }
    clearAlerts();

    try {
      const data = await patchConfig(nextEnabled);
      applyRecord(data);
      setSuccess(
        isToggle
          ? data.enabled
            ? "Fonction activee."
            : "Fonction desactivee."
          : "Configuration enregistree et mise a jour publiee."
      );
      return true;
    } catch (saveError) {
      setError(String(saveError));
      return false;
    } finally {
      if (isToggle) {
        setToggling(false);
      } else {
        setSaving(false);
      }
    }
  }

  async function toggleEnabled() {
    const previousEnabled = enabled;
    const nextEnabled = !previousEnabled;
    setEnabled(nextEnabled);

    const ok = await runSave("toggle", nextEnabled);
    if (!ok) {
      setEnabled(previousEnabled);
    }
  }

  return (
    <section className="panel-card">
      <header className="panel-card-header">
        <div>
          <h2>Createur vocal</h2>
          <p>Configurez la creation automatique et la gestion des vocaux temporaires.</p>
        </div>
        <span className={`status-badge ${enabled ? "on" : "off"}`}>
          {enabled ? "Activee" : "Desactivee"}
        </span>
      </header>

      {loading ? <p className="muted">Chargement...</p> : null}

      <div className="field-grid">
        <label className="switch-row">
          <span>Fonction activee</span>
          <button
            type="button"
            className={`discord-switch ${enabled ? "on" : "off"}`}
            onClick={() => void toggleEnabled()}
            disabled={loading || saving || toggling}
            aria-pressed={enabled}
            aria-label={enabled ? "Desactiver la fonction" : "Activer la fonction"}
          >
            <span className="discord-switch-knob" />
          </button>
        </label>

        <label className="field">
          <span>Salon createur</span>
          {guildMeta.voiceChannels.length > 0 ? (
            <select
              value={config.creatorChannelId}
              onChange={(event) => updateConfig({ creatorChannelId: event.target.value })}
            >
              <option value="">Selectionner un salon vocal</option>
              {getVoiceOptionsWithCurrent(config.creatorChannelId).map((channel) => (
                <option key={channel.id} value={channel.id}>
                  🔊 {channel.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.creatorChannelId}
              onChange={(event) => updateConfig({ creatorChannelId: event.target.value })}
              placeholder="ID salon createur (secours)"
            />
          )}
        </label>

        <label className="field">
          <span>Categorie cible</span>
          {guildMeta.categoryChannels.length > 0 ? (
            <select
              value={config.targetCategoryId}
              onChange={(event) => updateConfig({ targetCategoryId: event.target.value })}
            >
              <option value="">Selectionner une categorie</option>
              {getCategoryOptionsWithCurrent(config.targetCategoryId).map((channel) => (
                <option key={channel.id} value={channel.id}>
                  📁 {channel.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.targetCategoryId}
              onChange={(event) => updateConfig({ targetCategoryId: event.target.value })}
              placeholder="ID categorie cible (secours)"
            />
          )}
        </label>

        <label className="field">
          <span>Delai de suppression (ms)</span>
          <input
            type="number"
            min={1000}
            max={120000}
            step={500}
            value={config.emptyDeleteDelayMs}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              updateConfig({
                emptyDeleteDelayMs: Number.isFinite(parsed)
                  ? parsed
                  : config.emptyDeleteDelayMs,
              });
            }}
          />
        </label>

        <label className="field">
          <span>Prefixe du nom de salon</span>
          <input
            type="text"
            value={config.tempVoiceNamePrefix}
            onChange={(event) => updateConfig({ tempVoiceNamePrefix: event.target.value })}
            placeholder="🔊・Salon de "
          />
        </label>
      </div>

      {metaWarning ? <p className="muted">{metaWarning}</p> : null}

      <footer className="card-footer">
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
        <button
          onClick={() => void runSave("save", enabled)}
          disabled={!canSave || saving || toggling || loading}
        >
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </footer>
    </section>
  );
}
