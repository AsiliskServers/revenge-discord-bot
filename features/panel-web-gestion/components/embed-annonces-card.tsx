"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type GuildMeta = {
  channels: Array<{ id: string; name: string }>;
  warning?: string;
};

type EmbedDraft = {
  authorName: string;
  authorUrl: string;
  authorIconUrl: string;
  title: string;
  description: string;
  url: string;
  color: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  footerIconUrl: string;
};

type Props = {
  guildId: string;
};

const EMPTY_EMBED: EmbedDraft = {
  authorName: "",
  authorUrl: "",
  authorIconUrl: "",
  title: "",
  description: "",
  url: "",
  color: "e11d48",
  imageUrl: "",
  thumbnailUrl: "",
  footerText: "",
  footerIconUrl: "",
};

function normalizeHex(input: string): string {
  const value = input.replace(/^#/, "").trim();
  if (/^[0-9a-fA-F]{0,6}$/.test(value)) {
    return value;
  }
  return "e11d48";
}

function parseAttachmentUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export default function EmbedAnnouncementsCard({ guildId }: Props) {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [channelId, setChannelId] = useState("");
  const [content, setContent] = useState("");
  const [attachmentUrlsText, setAttachmentUrlsText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [embed, setEmbed] = useState<EmbedDraft>(EMPTY_EMBED);
  const [meta, setMeta] = useState<GuildMeta>({ channels: [] });

  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  async function loadMeta() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/embed-annonces?guildId=${guildId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Echec de chargement");
      }

      const nextMeta = (payload.meta || { channels: [] }) as GuildMeta;
      setMeta(nextMeta);
      if (nextMeta.channels.length > 0 && !channelId) {
        setChannelId(nextMeta.channels[0].id);
      }
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, [guildId]);

  function updateEmbed(patch: Partial<EmbedDraft>) {
    setEmbed((current) => ({ ...current, ...patch }));
  }

  function applyMarkdown(token: "**" | "*" | "__" | "~~") {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = embed.description;
    const selected = current.slice(start, end);

    const wrapped = `${token}${selected}${token}`;
    const next = current.slice(0, start) + wrapped + current.slice(end);

    updateEmbed({ description: next });

    requestAnimationFrame(() => {
      el.focus();
      if (selected.length === 0) {
        const cursor = start + token.length;
        el.setSelectionRange(cursor, cursor);
      } else {
        el.setSelectionRange(start + token.length, end + token.length);
      }
    });
  }

  const attachmentUrls = useMemo(() => parseAttachmentUrls(attachmentUrlsText), [attachmentUrlsText]);

  const canSend = useMemo(() => {
    const hasEmbed = Object.values(embed).some((value) => String(value).trim().length > 0);
    return Boolean(channelId && (content.trim() || attachmentUrls.length > 0 || files.length > 0 || hasEmbed));
  }, [attachmentUrls.length, channelId, content, embed, files.length]);

  async function sendAnnouncement() {
    if (!canSend || sending) {
      return;
    }

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const form = new FormData();
      form.append("guildId", guildId);
      form.append("channelId", channelId);
      form.append("content", content);
      form.append("attachmentUrls", JSON.stringify(attachmentUrls));
      form.append("embed", JSON.stringify(embed));

      files.slice(0, 10).forEach((file) => {
        form.append("files", file, file.name);
      });

      const response = await fetch("/api/embed-annonces", {
        method: "POST",
        body: form,
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.details || "Echec envoi");
      }

      setSuccess("Annonce envoyee avec succes.");
    } catch (sendError) {
      setError(String(sendError));
    } finally {
      setSending(false);
    }
  }

  const previewColor = /^([0-9a-fA-F]{6})$/.test(normalizeHex(embed.color))
    ? `#${normalizeHex(embed.color)}`
    : "#e11d48";

  return (
    <section className="panel-card">
      <header className="panel-card-header">
        <div>
          <h2>Embed annonces</h2>
          <p>Composez une annonce en texte simple, avec fichiers et embed, puis envoyez-la via le bot.</p>
        </div>
      </header>

      {loading ? <p className="muted">Chargement...</p> : null}

      <div className="annonce-layout">
        <div className="annonce-editor">
          <label className="field">
            <span>Salon cible</span>
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">Selectionner un salon</option>
              {meta.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Content</span>
            <textarea
              className="annonce-textarea"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Texte normal du message"
            />
          </label>

          <label className="field">
            <span>Attachments (URLs, une par ligne)</span>
            <textarea
              className="annonce-textarea"
              rows={3}
              value={attachmentUrlsText}
              onChange={(event) => setAttachmentUrlsText(event.target.value)}
              placeholder="https://..."
            />
          </label>

          <label className="field">
            <span>Attachments (fichiers locaux)</span>
            <input
              type="file"
              multiple
              onChange={(event) => {
                const list = event.target.files ? Array.from(event.target.files) : [];
                setFiles(list.slice(0, 10));
              }}
            />
            {files.length > 0 ? (
              <p className="muted small">{files.map((file) => file.name).join(" | ")}</p>
            ) : null}
          </label>

          <div className="embed-section">
            <h3>Embed</h3>

            <label className="field">
              <span>Author</span>
              <input
                value={embed.authorName}
                maxLength={256}
                onChange={(event) => updateEmbed({ authorName: event.target.value })}
              />
              <small className="muted small">{embed.authorName.length} / 256</small>
            </label>

            <label className="field">
              <span>Author URL</span>
              <input
                value={embed.authorUrl}
                onChange={(event) => updateEmbed({ authorUrl: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Author Icon URL</span>
              <input
                value={embed.authorIconUrl}
                onChange={(event) => updateEmbed({ authorIconUrl: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Title</span>
              <input
                value={embed.title}
                maxLength={256}
                onChange={(event) => updateEmbed({ title: event.target.value })}
              />
              <small className="muted small">{embed.title.length} / 256</small>
            </label>

            <label className="field">
              <span>Description</span>
              <div className="desc-toolbar">
                <button type="button" onClick={() => applyMarkdown("**")}>B</button>
                <button type="button" onClick={() => applyMarkdown("*")}>I</button>
                <button type="button" onClick={() => applyMarkdown("__")}>U</button>
                <button type="button" onClick={() => applyMarkdown("~~")}>S</button>
              </div>
              <textarea
                ref={descriptionRef}
                className="annonce-textarea"
                rows={6}
                value={embed.description}
                maxLength={4096}
                onChange={(event) => updateEmbed({ description: event.target.value })}
              />
              <small className="muted small">{embed.description.length} / 4096</small>
              <small className="muted small">Description is required when no other fields are set</small>
            </label>

            <label className="field">
              <span>URL</span>
              <input
                value={embed.url}
                onChange={(event) => updateEmbed({ url: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Color (#)</span>
              <input
                value={embed.color}
                onChange={(event) => updateEmbed({ color: normalizeHex(event.target.value) })}
              />
            </label>

            <label className="field">
              <span>Image URL</span>
              <input
                value={embed.imageUrl}
                onChange={(event) => updateEmbed({ imageUrl: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Thumbnail URL</span>
              <input
                value={embed.thumbnailUrl}
                onChange={(event) => updateEmbed({ thumbnailUrl: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Footer</span>
              <input
                value={embed.footerText}
                maxLength={2048}
                onChange={(event) => updateEmbed({ footerText: event.target.value })}
              />
              <small className="muted small">{embed.footerText.length} / 2048</small>
            </label>

            <label className="field">
              <span>Footer Icon URL</span>
              <input
                value={embed.footerIconUrl}
                onChange={(event) => updateEmbed({ footerIconUrl: event.target.value })}
              />
            </label>
          </div>

          <div className="card-footer">
            {error ? <p className="error">{error}</p> : null}
            {success ? <p className="success">{success}</p> : null}
            <button onClick={() => void sendAnnouncement()} disabled={!canSend || sending || loading}>
              {sending ? "Envoi..." : "Envoyer"}
            </button>
          </div>
        </div>

        <div className="annonce-preview">
          <h3>Previsualisation</h3>
          <div className="discord-message-preview">
            {content.trim() ? <p className="preview-content">{content}</p> : null}
            {attachmentUrls.length > 0 ? (
              <div className="preview-attachments">
                {attachmentUrls.map((url, index) => (
                  <p key={`${url}-${index}`}>{url}</p>
                ))}
              </div>
            ) : null}
            {files.length > 0 ? (
              <div className="preview-attachments">
                {files.map((file) => (
                  <p key={file.name}>📎 {file.name}</p>
                ))}
              </div>
            ) : null}

            {(Object.values(embed).some((value) => String(value).trim().length > 0)) ? (
              <div className="embed-preview" style={{ borderLeftColor: previewColor }}>
                {embed.authorName ? (
                  <p className="embed-author">{embed.authorName}</p>
                ) : null}
                {embed.title ? <p className="embed-title">{embed.title}</p> : null}
                {embed.description ? (
                  <p className="embed-description">{embed.description}</p>
                ) : null}
                {embed.thumbnailUrl ? (
                  <img className="embed-thumb" src={embed.thumbnailUrl} alt="thumbnail" />
                ) : null}
                {embed.imageUrl ? <img className="embed-image" src={embed.imageUrl} alt="image" /> : null}
                {embed.footerText ? <p className="embed-footer">{embed.footerText}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {meta.warning ? <p className="muted">{meta.warning}</p> : null}
    </section>
  );
}
