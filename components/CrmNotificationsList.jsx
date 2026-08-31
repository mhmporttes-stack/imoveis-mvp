"use client";

import { useState } from "react";
import { Bell, Check } from "lucide-react";

export default function CrmNotificationsList({ initialNotifications = [] }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [busyId, setBusyId] = useState("");

  async function markRead(notification) {
    if (notification.readAt || busyId) return;
    setBusyId(notification.id);
    try {
      const response = await fetch(`/api/crm-notifications/${notification.id}`, { method: "PATCH" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a notificação.");
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, readAt: payload.notification.readAt || new Date().toISOString() } : item
      )));
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusyId("");
    }
  }

  if (!notifications.length) {
    return (
      <section className="container-page rounded-[28px] border border-line bg-white p-10 text-center shadow-soft">
        <Bell className="mx-auto h-8 w-8 text-brand" aria-hidden="true" />
        <p className="mt-4 text-xl font-black text-navy">Nenhuma notificação.</p>
      </section>
    );
  }

  return (
    <section className="container-page grid gap-3">
      {notifications.map((notification) => (
        <article key={notification.id} className={`rounded-2xl border p-5 shadow-sm ${notification.readAt ? "border-line bg-white" : "border-brand/25 bg-blue-50"}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-brand">
                {notification.recipientName}{notification.clientName ? ` · ${notification.clientName}` : ""}
              </p>
              <h2 className="mt-2 text-lg font-black text-navy">{notification.title}</h2>
              {notification.description ? <p className="mt-2 leading-7 text-muted">{notification.description}</p> : null}
              <p className="mt-3 text-xs font-bold text-muted">{formatDateTime(notification.scheduledAt)}</p>
            </div>
            {!notification.readAt ? (
              <button
                type="button"
                onClick={() => markRead(notification)}
                disabled={busyId === notification.id}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand/20 bg-white text-brand"
                aria-label="Marcar como lida"
                title="Marcar como lida"
              >
                <Check className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(new Date(value));
  } catch {
    return "";
  }
}
