/** Native routes/settings are independent of optional shortcut enumeration. */
export async function startPlugin<T>(options: {
  ready(): Promise<boolean>;
  cancelled(): boolean;
  startNative(): void;
  discover(): Promise<T | null>;
  startShortcuts(details: T): void;
  retry(): Promise<void>;
}): Promise<void> {
  if (!await options.ready() || options.cancelled()) return;
  options.startNative();
  while (!options.cancelled()) {
    const details = await options.discover().catch(() => null);
    if (options.cancelled()) return;
    if (details !== null) {
      options.startShortcuts(details);
      return;
    }
    await options.retry();
  }
}
