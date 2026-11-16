/**
 * Desktop notifications for a viewer-driven Run.
 *
 * The tab is usually in the background while workers run, and a Run that is
 * waiting on a human only changes pixels: a task lands, a gate goes pending,
 * nothing beeps. The browser Notification API is the one signal that can reach
 * past the tab — the server has no cross-platform notifier, and the viewer is
 * deliberately a browser app.
 *
 * Chrome refuses `requestPermission()` without a user gesture, so permission is
 * asked from the Run button (`askPermission`), not on load. Without it every
 * call below is a silent no-op — the viewer still works exactly as before.
 */

export function notificationsAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Ask once, from a click handler. Safe to call on every click. */
export function askPermission(): void {
  if (!notificationsAvailable() || Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => {
    /* denied, or the platform does not support the prompt */
  });
}

export function notify(title: string, body: string, tag?: string): void {
  if (!notificationsAvailable() || Notification.permission !== "granted") return;
  try {
    // `tag` collapses repeats of the same event instead of stacking a pile of
    // identical cards when two polls see the same transition.
    new Notification(title, { body, tag });
  } catch {
    /* some platforms throw when the page is not focused; drop the notification */
  }
}