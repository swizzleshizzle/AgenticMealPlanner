import { apiFetch } from "./client";

export const syncCalendar = (planId: number) =>
  apiFetch<{ synced: number }>(`/calendar/sync/${planId}`, { method: "POST" });
