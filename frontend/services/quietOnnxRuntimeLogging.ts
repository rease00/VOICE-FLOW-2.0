let onnxRuntimeLoggingQuieted: Promise<void> | null = null;

export const quietOnnxRuntimeLogging = async (): Promise<void> => {
  if (onnxRuntimeLoggingQuieted) return onnxRuntimeLoggingQuieted;

  onnxRuntimeLoggingQuieted = (async () => {
    try {
      const { env: onnxRuntimeEnv } = await import('onnxruntime-web');
      (onnxRuntimeEnv as any).logLevel = 'fatal';
    } catch {
      // Best effort only.
    }
  })();

  return onnxRuntimeLoggingQuieted;
};
