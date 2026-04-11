'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import type { AppNotification } from '../../shared/notifications/types';

interface NotificationCenterProps {
  notifications: AppNotification[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  onDismiss?: (id: string) => void;
  onNavigate?: (notification: AppNotification) => void;
}

export default function NotificationCenter({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onNavigate,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.readAt === null).length,
    [notifications],
  );

  const handleToggle = useCallback(() => setOpen((v) => !v), []);

  const handleClickNotification = useCallback(
    (n: AppNotification) => {
      if (n.readAt === null) onMarkRead?.(n.id);
      onNavigate?.(n);
    },
    [onMarkRead, onNavigate],
  );

  return (
    <div className="relative">
      {/* Bell icon */}
      <button
        onClick={handleToggle}
        className="relative rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel (desktop) / full overlay (mobile) */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent"
            onClick={handleToggle}
          />

          <div className="fixed inset-x-0 top-0 z-50 h-full sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:w-96 sm:inset-x-auto">
            <div className="flex h-full flex-col bg-slate-900 sm:max-h-96 sm:rounded-2xl sm:border sm:border-slate-700/60 sm:shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-100">Notifications</h3>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={onMarkAllRead}
                      className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
                      aria-label="Mark all as read"
                    >
                      <CheckCheck className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={handleToggle}
                    className="rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 sm:hidden"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">No notifications</p>
                ) : (
                  <ul>
                    {notifications.map((n) => (
                      <li
                        key={n.id}
                        className={`flex cursor-pointer items-start gap-3 border-b border-slate-800/50 px-4 py-3 transition hover:bg-slate-800/40 ${
                          n.readAt === null ? 'bg-slate-800/20' : ''
                        }`}
                        onClick={() => handleClickNotification(n)}
                      >
                        {/* Unread dot */}
                        <div className="mt-1.5 flex-shrink-0">
                          {n.readAt === null ? (
                            <div className="h-2 w-2 rounded-full bg-indigo-500" />
                          ) : (
                            <div className="h-2 w-2" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-200">{n.title}</p>
                          <p className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">
                            {n.message}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {formatRelativeTime(n.createdAt)}
                          </p>
                        </div>

                        {onDismiss && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDismiss(n.id);
                            }}
                            className="flex-shrink-0 rounded p-0.5 text-slate-500 transition hover:text-slate-300"
                            aria-label="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}
