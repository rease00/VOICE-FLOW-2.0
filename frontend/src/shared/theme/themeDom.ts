import { DEFAULT_UI_BRAND_THEME, resolveUiBrandThemeId, type UiBrandThemeId } from './brandThemes';

export type UiThemeMode = 'light' | 'dark' | 'system';
export type ResolvedUiThemeMode = 'light' | 'dark';

const setDatasetValue = (element: HTMLElement, key: string, value: string | null): void => {
  if (value) {
    element.dataset[key as keyof DOMStringMap] = value;
    return;
  }
  delete element.dataset[key as keyof DOMStringMap];
};

const snapshotThemeState = (body: HTMLElement, root: HTMLElement) => ({
  bodyThemeDark: body.classList.contains('theme-dark'),
  bodyVfThemeDark: body.classList.contains('vf-theme-dark'),
  bodyVfThemeLight: body.classList.contains('vf-theme-light'),
  bodyTheme: body.dataset.theme || null,
  bodyVfThemeMode: body.dataset.vfThemeMode || null,
  bodyVfResolvedTheme: body.dataset.vfResolvedTheme || null,
  bodyVfBrandTheme: body.dataset.vfBrandTheme || null,
  rootThemeDark: root.classList.contains('theme-dark'),
  rootVfThemeDark: root.classList.contains('vf-theme-dark'),
  rootVfThemeLight: root.classList.contains('vf-theme-light'),
  rootTheme: root.dataset.theme || null,
  rootVfThemeMode: root.dataset.vfThemeMode || null,
  rootVfResolvedTheme: root.dataset.vfResolvedTheme || null,
  rootVfBrandTheme: root.dataset.vfBrandTheme || null,
});

export const applyThemeModeToDocument = (
  doc: Pick<Document, 'body' | 'documentElement'>,
  themeMode: UiThemeMode,
  resolvedTheme: ResolvedUiThemeMode,
): (() => void) => {
  const body = doc.body;
  const root = doc.documentElement;
  const previous = snapshotThemeState(body, root);

  body.classList.toggle('theme-dark', resolvedTheme === 'dark');
  body.classList.toggle('vf-theme-dark', resolvedTheme === 'dark');
  body.classList.toggle('vf-theme-light', resolvedTheme === 'light');
  root.classList.toggle('theme-dark', resolvedTheme === 'dark');
  root.classList.toggle('vf-theme-dark', resolvedTheme === 'dark');
  root.classList.toggle('vf-theme-light', resolvedTheme === 'light');
  setDatasetValue(body, 'theme', resolvedTheme);
  setDatasetValue(body, 'vfThemeMode', themeMode);
  setDatasetValue(body, 'vfResolvedTheme', resolvedTheme);
  setDatasetValue(root, 'theme', resolvedTheme);
  setDatasetValue(root, 'vfThemeMode', themeMode);
  setDatasetValue(root, 'vfResolvedTheme', resolvedTheme);

  return () => {
    body.classList.toggle('theme-dark', previous.bodyThemeDark);
    body.classList.toggle('vf-theme-dark', previous.bodyVfThemeDark);
    body.classList.toggle('vf-theme-light', previous.bodyVfThemeLight);
    root.classList.toggle('theme-dark', previous.rootThemeDark);
    root.classList.toggle('vf-theme-dark', previous.rootVfThemeDark);
    root.classList.toggle('vf-theme-light', previous.rootVfThemeLight);
    setDatasetValue(body, 'theme', previous.bodyTheme);
    setDatasetValue(body, 'vfThemeMode', previous.bodyVfThemeMode);
    setDatasetValue(body, 'vfResolvedTheme', previous.bodyVfResolvedTheme);
    setDatasetValue(root, 'theme', previous.rootTheme);
    setDatasetValue(root, 'vfThemeMode', previous.rootVfThemeMode);
    setDatasetValue(root, 'vfResolvedTheme', previous.rootVfResolvedTheme);
  };
};

export const applyBrandThemeToDocument = (
  doc: Pick<Document, 'body' | 'documentElement'>,
  themeId: UiBrandThemeId,
): (() => void) => {
  const body = doc.body;
  const root = doc.documentElement;
  const previous = snapshotThemeState(body, root);
  const brandTheme = resolveUiBrandThemeId(themeId);

  setDatasetValue(body, 'vfBrandTheme', brandTheme);
  setDatasetValue(root, 'vfBrandTheme', brandTheme);

  return () => {
    setDatasetValue(body, 'vfBrandTheme', previous.bodyVfBrandTheme);
    setDatasetValue(root, 'vfBrandTheme', previous.rootVfBrandTheme);
    if (!previous.bodyVfThemeDark) body.classList.remove('vf-theme-dark');
    if (!previous.bodyThemeDark) body.classList.remove('theme-dark');
    if (!previous.bodyVfThemeLight) body.classList.remove('vf-theme-light');
    if (!previous.rootVfThemeDark) root.classList.remove('vf-theme-dark');
    if (!previous.rootThemeDark) root.classList.remove('theme-dark');
    if (!previous.rootVfThemeLight) root.classList.remove('vf-theme-light');
  };
};

export const readUiBrandThemeFromStorage = (value: string | null | undefined): UiBrandThemeId => resolveUiBrandThemeId(value || DEFAULT_UI_BRAND_THEME);
