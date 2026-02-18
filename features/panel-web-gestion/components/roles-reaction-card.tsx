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

type GuildMeta = {
  channels: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
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

export default function RolesReactionCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [roles, setRoles] = useState<RoleReactionEntry[]>([]);
  const [guildMeta, setGuildMeta] = useState<GuildMeta>({
    channels: [],
    roles: [],
  });
  const [metaWarning, setMetaWarning] = useState<string | null>(null);

  function clearAlerts() {
    setError(null);
    setSuccess(null);
  }

  function applyRecord(data: ApiRecord) {
    setEnabled(Boolean(data.enabled));
    setChannelId(data.config.channelId || "");
    setRoles(data.config.roles || []);
  }

  async function fetchRecord(): Promise<{ record: ApiRecord; meta: GuildMeta }> {
    const response = await fetch(`/api/features/roles-reaction?guildId=${guildId}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiGetPayload;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Échec de chargement");
    }
    return {
      record: payload.data as ApiRecord,
      meta: payload.meta || { channels: [], roles: [] },
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

  function updateRoleId(index: number, roleId: string) {
    const selected = guildMeta.roles.find((role) => role.id === roleId);
    setRoles((current) =>
      current.map((item, idx) => {
        if (idx !== index) {
          return item;
        }
        return {
          ...item,
          roleId,
          label: item.label?.trim() ? item.label : selected?.name || item.label,
        };
      })
    );
  }

  function getRoleOptionsWithCurrent(currentRoleId: string) {
    const base = guildMeta.roles;
    if (!currentRoleId || base.some((role) => role.id === currentRoleId)) {
      return base;
    }
    return [{ id: currentRoleId, name: `Rôle actuel (${currentRoleId})` }, ...base];
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
            ? "Fonction activée."
            : "Fonction désactivée."
          : "Configuration enregistrée et mise à jour publiée."
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
          <h2>Rôles réactions</h2>
          <p>Activez ou désactivez la fonction et configurez les rôles attribuables.</p>
        </div>
        <span className={`status-badge ${enabled ? "on" : "off"}`}>
          {enabled ? "Activée" : "Désactivée"}
        </span>
      </header>

      {loading ? <p className="muted">Chargement...</p> : null}

      <div className="field-grid">
        <label className="switch-row">
          <span>Fonction activée</span>
          <button
            type="button"
            className={`discord-switch ${enabled ? "on" : "off"}`}
            onClick={() => void toggleEnabled()}
            disabled={loading || saving || toggling}
            aria-pressed={enabled}
            aria-label={enabled ? "Désactiver la fonction" : "Activer la fonction"}
          >
            <span className="discord-switch-knob" />
          </button>
        </label>

        <label className="field">
          <span>Salon cible</span>
          {guildMeta.channels.length > 0 ? (
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">Sélectionner un salon</option>
              {guildMeta.channels.map((channel) => (
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
      </div>

      {metaWarning ? <p className="muted">{metaWarning}</p> : null}

      <div className="roles-grid">
        {roles.map((role, index) => (
          <article key={role.key} className="role-item">
            <div className="role-label">{role.label}</div>
            <label className="field">
              <span>Rôle</span>
              {guildMeta.roles.length > 0 ? (
                <select
                  value={role.roleId}
                  onChange={(event) => updateRoleId(index, event.target.value)}
                >
                  <option value="">Sélectionner un rôle</option>
                  {getRoleOptionsWithCurrent(role.roleId).map((option) => (
                    <option key={option.id} value={option.id}>
                      @{option.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={role.roleId}
                  onChange={(event) => updateRole(index, { roleId: event.target.value })}
                />
              )}
            </label>
            <label className="field">
              <span>Libellé bouton</span>
              <input
                type="text"
                value={role.label}
                onChange={(event) => updateRole(index, { label: event.target.value })}
              />
            </label>
          </article>
        ))}
      </div>

      <footer className="card-footer">
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
        <button onClick={() => void save()} disabled={!canSave || saving || toggling || loading}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </footer>
    </section>
  );
}
