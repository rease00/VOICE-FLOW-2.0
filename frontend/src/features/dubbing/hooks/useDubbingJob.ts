import { useCallback } from 'react';
import {
  buildDubAlignmentReport,
  type DubbingStemExtractionOptions,
  extractAndSeparateDubbingStems,
  mixFinalDub,
} from '../../../../services/dubbingService';

export const useDubbingJob = () => {
  const prepareStems = useCallback(async (
    sourceFile: File,
    options?: { mediaBackendUrl?: string; useModelSourceSeparation?: boolean }
  ) => {
    const normalized: DubbingStemExtractionOptions | undefined = options
      ? {
          ...(options.mediaBackendUrl ? { backendUrl: options.mediaBackendUrl } : {}),
          ...(typeof options.useModelSourceSeparation === 'boolean'
            ? { preferBackendModel: options.useModelSourceSeparation }
            : {}),
        }
      : undefined;
    return extractAndSeparateDubbingStems(sourceFile, normalized);
  }, []);

  return {
    prepareStems,
    mixFinalDub,
    buildDubAlignmentReport,
  };
};
