export type StudioGenerateDockMode = 'phone' | 'tablet' | 'desktop';

export interface ResolveStudioGenerateDockMetricsInput {
  viewportWidth: number;
  mode: StudioGenerateDockMode;
  editorLeft?: number | null;
  editorWidth?: number | null;
  isLargeDesktop?: boolean;
  isNarrowDesktop?: boolean;
}

export interface StudioGenerateDockMetrics {
  centerX: number;
  width: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizePositiveNumber = (value: number | null | undefined, fallback: number): number => (
  Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : fallback
);

export const resolveStudioGenerateDockMetrics = (
  input: ResolveStudioGenerateDockMetricsInput,
): StudioGenerateDockMetrics => {
  const viewportWidth = normalizePositiveNumber(input.viewportWidth, 1366);
  const editorWidth = normalizePositiveNumber(input.editorWidth, viewportWidth);
  const editorLeft = Number.isFinite(input.editorLeft) ? Number(input.editorLeft) : null;
  const centerX = editorLeft !== null ? Math.round(editorLeft + (editorWidth / 2)) : Math.round(viewportWidth / 2);

  const viewportGutter = input.mode === 'phone' ? 16 : input.mode === 'tablet' ? 28 : 32;
  const editorPaddingAllowance = input.mode === 'phone'
    ? 12
    : input.mode === 'tablet'
      ? 24
      : input.isLargeDesktop
        ? 56
        : 40;

  const minWidth = input.mode === 'phone'
    ? 260
    : input.mode === 'tablet'
      ? 300
      : input.isNarrowDesktop
        ? 320
        : 340;

  const maxWidthCap = input.mode === 'phone'
    ? 450
    : input.mode === 'tablet'
      ? 410
      : input.isNarrowDesktop
        ? 420
        : input.isLargeDesktop
          ? 480
          : 460;

  const ratio = input.mode === 'phone'
    ? 0.94
    : input.mode === 'tablet'
      ? 0.52
      : input.isNarrowDesktop
        ? 0.38
        : input.isLargeDesktop
          ? 0.34
          : 0.36;

  const desiredWidth = Math.round(editorWidth * ratio);
  const maxWidth = Math.max(
    minWidth,
    Math.min(
      Math.max(240, viewportWidth - viewportGutter),
      Math.max(240, editorWidth - editorPaddingAllowance),
      maxWidthCap,
    ),
  );

  return {
    centerX,
    width: clamp(desiredWidth, minWidth, maxWidth),
  };
};
