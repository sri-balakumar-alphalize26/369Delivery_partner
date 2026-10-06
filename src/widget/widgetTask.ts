import { riderWidget, widgetLib, WIDGET_NAME } from './RiderWidget';
import { loadSnapshot, saveSnapshot, WidgetSnapshot } from './widgetSnapshot';

/**
 * The widget's side of things. Android asks the app to draw the widget when it
 * is added, resized or due an update, often with the app closed: this draws
 * it from the last snapshot. Registered from the app's entry (index.js).
 */
export function registerWidgetTask(): void {
  const w = widgetLib();
  if (!w) return;
  w.registerWidgetTaskHandler(async ({ widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
    const tree = riderWidget(await loadSnapshot());
    if (tree) renderWidget(tree);
  });
}

let last = '';

/** Save what the widget shows and redraw it, when something changed. */
export async function updateWidget(s: Omit<WidgetSnapshot, 'savedAt'>): Promise<void> {
  const w = widgetLib();
  if (!w) return;
  const key = JSON.stringify(s);
  if (key === last) return;
  last = key;
  const snap = { ...s, savedAt: Date.now() };
  await saveSnapshot(snap);
  try {
    await w.requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => riderWidget(snap)!,
    });
  } catch {
    // No widget on the home screen, or not this build.
  }
}
