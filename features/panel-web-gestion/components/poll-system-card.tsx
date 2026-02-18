"use client";

import { useEffect, useMemo, useState } from "react";

type PollSystemFeatureConfig = {
  channelId: string;
  maxActiveSuggestionsPerUser: number;
};

type ApiRecord = {
  guildId: string;
  featureKey: string;
  enabled: boolean;
  config: PollSystemFeatureConfig;
  updatedAt: string;
};

type GuildMeta = {
  channels: Array<{ id: string; name: string }>;
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

export default function PollSystemCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metaWarning, setMetaWarning] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [maxActiveSuggestionsPerUser, setMaxActiveSuggestionsPerUser] = useState(2);
  const [guildMeta, setGuildMeta] = useState<GuildMeta>({ channels: [] });

  function clearAlerts() {
    setError(null);
    setSuccess(null);
  }

  function applyRecord(data: ApiRecord) {
    setEnabled(Boolean(data.enabled));
    setChannelId(data.config.channelId || "");
    setMaxActiveSuggestionsPerUser(Number(data.config.maxActiveSuggestionsPerUser) || 2);
  }

  async function fetchRecord(): Promise<{ record: ApiRecord; meta: GuildMeta }> {
    const response = await fetch(`/api/features/poll-system?guildId=${guildId}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiGetPayload;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Echec de chargement");
    }

    return {
      record: payload.data as ApiRecord,
      meta: payload.meta || { channels: [] },
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
    if (!channelId.trim()) {
      return false;
    }
    const max = Number(maxActiveSuggestionsPerUser);
    return Number.isInteger(max) && max >= 1 && max <= 10;
  }, [channelId, maxActiveSuggestionsPerUser]);

  async function patchConfig(nextEnabled: boolean): Promise<ApiRecord> {
    const response = await fetch("/api/features/poll-system", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId,
        enabled: nextEnabled,
        config: {
          channelId,
          maxActiveSuggestionsPerUser,
        },
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

  function getChannelOptionsWithCurrent(currentId: string) {
    if (!currentId || guildMeta.channels.some((channel) => channel.id === currentId)) {
      return guildMeta.channels;
    }
    return [{ id: currentId, name: `Salon actuel (${currentId})` }, ...guildMeta.channels];
  }

  return (
    <section className="panel-card">
      <header className="panel-card-header">
        <div>
          <h2>Systeme sondage</h2>
          <p>Parametres du hub de suggestions et limite utilisateur.</p>
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
          <span>Salon suggestions</span>
          {guildMeta.channels.length > 0 ? (
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">Selectionner un salon</option>
              {getChannelOptionsWithCurrent(channelId).map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="ID du salon (secours)"
            />
          )}
        </label>

        <label className="field">
          <span>Suggestions actives max / utilisateur</span>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={maxActiveSuggestionsPerUser}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              setMaxActiveSuggestionsPerUser(
                Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.floor(parsed))) : 2
              );
            }}
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
