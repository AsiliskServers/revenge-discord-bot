"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoleReactionEntry, RoleReactionFeatureConfig } from "@/lib/types";

type ApiRecord = {
  guildId: string;
  featureKey: string;
  enabled: boolean;
  config: RoleReactionFeatureConfig;
  updatedAt: string;
};

type Props = {
  guildId: string;
};

type SaveMode = "toggle" | "save";

export default function RolesReactionCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [roles, setRoles] = useState<RoleReactionEntry[]>([]);

  function clearAlerts() {
    setError(null);
    setSuccess(null);
  }

  function applyRecord(data: ApiRecord) {
    setEnabled(Boolean(data.enabled));
    setChannelId(data.config.channelId || "");
    setRoles(data.config.roles || []);
  }

  async function fetchRecord(): Promise<ApiRecord> {
    const response = await fetch(`/api/features/roles-reaction?guildId=${guildId}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Échec de chargement");
    }
    return payload.data as ApiRecord;
  }

  async function load() {
    setLoading(true);
    clearAlerts();
    try {
      applyRecord(await fetchRecord());
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
    if (roles.length === 0) {
      return false;
    }
    return roles.every((entry) => entry.roleId.trim().length > 0);
  }, [channelId, roles]);

  function updateRole(index: number, patch: Partial<RoleReactionEntry>) {
    setRoles((current) =>
      current.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  async function patchConfig(
    nextEnabled: boolean,
    nextChannelId: string,
    nextRoles: RoleReactionEntry[]
  ): Promise<ApiRecord> {
    const response = await fetch("/api/features/roles-reaction", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId,
        enabled: nextEnabled,
        config: {
          channelId: nextChannelId,
          roles: nextRoles,
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Échec de sauvegarde");
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
      const data = await patchConfig(nextEnabled, channelId.trim(), roles);
      applyRecord(data);
      setSuccess(
        isToggle
          ? data.enabled
            ? "Feature activée."
            : "Feature désactivée."
          : "Configuration sauvegardée et événement Redis publié."
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

  async function save() {
    await runSave("save", enabled);
  }

  return (
    <section className="panel-card">
      <header className="panel-card-header">
        <div>
          <h2>Roles Reaction</h2>
          <p>Active/désactive et configure le panel de rôles réaction.</p>
        </div>
        <span className={`status-badge ${enabled ? "on" : "off"}`}>
          {enabled ? "Activé" : "Désactivé"}
        </span>
      </header>

      {loading ? <p className="muted">Chargement...</p> : null}

      <div className="field-grid">
        <label className="switch-row">
          <span>Feature activée</span>
          <button
            type="button"
            className={`discord-switch ${enabled ? "on" : "off"}`}
            onClick={() => void toggleEnabled()}
            disabled={loading || saving || toggling}
            aria-pressed={enabled}
            aria-label={enabled ? "Désactiver la feature" : "Activer la feature"}
          >
            <span className="discord-switch-knob" />
          </button>
        </label>

        <label className="field">
          <span>Guild ID</span>
          <input type="text" value={guildId} disabled />
        </label>

        <label className="field">
          <span>Channel ID cible</span>
          <input
            type="text"
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            placeholder="1470813116395946229"
          />
        </label>
      </div>

      <div className="roles-grid">
        {roles.map((role, index) => (
          <article key={role.key} className="role-item">
            <div className="role-label">{role.label}</div>
            <label className="field">
              <span>Role ID</span>
              <input
                type="text"
                value={role.roleId}
                onChange={(event) => updateRole(index, { roleId: event.target.value })}
              />
            </label>
          </article>
        ))}
      </div>

      <footer className="card-footer">
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
        <button onClick={() => void save()} disabled={!canSave || saving || toggling || loading}>
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </button>
      </footer>
    </section>
  );
}
