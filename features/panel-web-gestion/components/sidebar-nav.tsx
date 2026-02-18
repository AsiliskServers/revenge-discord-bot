"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type PanelSection =
  | "roles-reaction"
  | "voice-creator"
  | "poll-system"
  | "welcome-message"
  | "embed-annonces";

type NavItem = {
  key: PanelSection;
  label: string;
  href: string;
};

type Props = {
  active: PanelSection;
  userId: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: "roles-reaction", label: "Roles reactions", href: "/roles-reaction" },
  { key: "voice-creator", label: "Createur vocal", href: "/voice-creator" },
  { key: "poll-system", label: "Systeme sondage", href: "/systeme-sondage" },
  { key: "welcome-message", label: "Message bienvenue", href: "/message-bienvenue" },
  { key: "embed-annonces", label: "Embed annonces", href: "/embed-annonces" },
];

function storageKey(userId: string) {
  return `revenge_panel_nav_order:${userId}`;
}

function sanitizeOrder(raw: unknown): PanelSection[] {
  if (!Array.isArray(raw)) {
    return NAV_ITEMS.map((item) => item.key);
  }

  const allowed = new Set(NAV_ITEMS.map((item) => item.key));
  const cleaned = raw
    .map((item) => String(item) as PanelSection)
    .filter((item) => allowed.has(item));

  for (const item of NAV_ITEMS.map((entry) => entry.key)) {
    if (!cleaned.includes(item)) {
      cleaned.push(item);
    }
  }

  return cleaned;
}

export default function SidebarNav({ active, userId }: Props) {
  const [order, setOrder] = useState<PanelSection[]>(() => NAV_ITEMS.map((item) => item.key));
  const [draggingKey, setDraggingKey] = useState<PanelSection | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(userId));
      if (!raw) {
        setOrder(NAV_ITEMS.map((item) => item.key));
        return;
      }

      const parsed = JSON.parse(raw);
      setOrder(sanitizeOrder(parsed));
    } catch {
      setOrder(NAV_ITEMS.map((item) => item.key));
    }
  }, [userId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(order));
    } catch {
      // ignore storage failures
    }
  }, [order, userId]);

  const navByKey = useMemo(() => {
    return new Map(NAV_ITEMS.map((item) => [item.key, item]));
  }, []);

  function moveBefore(target: PanelSection) {
    if (!draggingKey || draggingKey === target) {
      return;
    }

    setOrder((current) => {
      const from = current.indexOf(draggingKey);
      const to = current.indexOf(target);
      if (from < 0 || to < 0 || from === to) {
        return current;
      }

      const next = [...current];
      next.splice(from, 1);
      const insertAt = next.indexOf(target);
      next.splice(insertAt, 0, draggingKey);
      return next;
    });
  }

  function resetOrder() {
    setOrder(NAV_ITEMS.map((item) => item.key));
  }

  return (
    <>
      <nav className="sidebar-nav">
        {order.map((key) => {
          const item = navByKey.get(key);
          if (!item) {
            return null;
          }

          return (
            <div
              key={item.key}
              className={`sidebar-nav-item ${draggingKey === item.key ? "dragging" : ""}`}
              draggable
              onDragStart={() => setDraggingKey(item.key)}
              onDragEnd={() => setDraggingKey(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveBefore(item.key);
                setDraggingKey(null);
              }}
            >
              <button
                type="button"
                className="drag-handle"
                aria-label={`Deplacer ${item.label}`}
                title="Glisser-deposer pour reordonner"
              >
                ::
              </button>
              <Link className={active === item.key ? "active" : ""} href={item.href}>
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <button type="button" className="sidebar-reset" onClick={resetOrder}>
        Reinitialiser l'ordre
      </button>
    </>
  );
}
