type KokoroBrowserRuntimeModule = typeof import('./kokoroBrowserRuntime.impl');

let runtimeModulePromise: Promise<KokoroBrowserRuntimeModule> | null = null;

export const loadKokoroBrowserRuntimeModule = async (): Promise<KokoroBrowserRuntimeModule> => {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import('./kokoroBrowserRuntime.impl');
  }
  return runtimeModulePromise;
};
