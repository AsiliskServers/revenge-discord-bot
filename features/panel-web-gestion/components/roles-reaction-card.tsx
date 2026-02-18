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

export default function RolesReactionCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [roles, setRoles] = useState<RoleReactionEntry[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/features/roles-reaction?guildId=${guildId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Échec de chargement");
      }

      const data: ApiRecord = payload.data;
      setEnabled(Boolean(data.enabled));
      setChannelId(data.config.channelId || "");
      setRoles(data.config.roles || []);
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

  async function save() {
    if (!canSave || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/features/roles-reaction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          enabled,
          config: {
            channelId: channelId.trim(),
            roles,
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Échec de sauvegarde");
      }

      setSuccess("Configuration sauvegardée et événement Redis publié.");
      await load();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
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
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
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
        <button onClick={save} disabled={!canSave || saving || loading}>
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </button>
      </footer>
    </section>
  );
}
