interface LibrarySection {
  key?: string | null;
  props?: { id?: string; overview?: unknown; onShowLaunchingDetails?: unknown };
}

/** The isolated Steam tree assumption. Fail closed when Steam changes its panel shape. */
export function streamActionIndex(sections: readonly LibrarySection[]): number | null {
  if (sections.some((section) => section?.key === "pyrodeck" || section?.props?.id === "pyrodeck")) return null;
  const nativePanel = sections.findIndex((section) => section?.props?.overview && section?.props?.onShowLaunchingDetails);
  return nativePanel < 0 ? null : nativePanel + 1;
}
