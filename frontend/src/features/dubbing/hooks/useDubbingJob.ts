import { useCallback } from 'react';
import {
  buildDubAlignmentReport,
  extractAndSeparateDubbingStems,
  mixFinalDub,
} from '../../../../services/dubbingService';

export const useDubbingJob = () => {
  const prepareStems = useCallback(async (sourceFile: File, options?: { mediaBackendUrl?: string; useModelSourceSeparation?: boolean }) => {
    return extractAndSeparateDubbingStems(sourceFile, options);
  }, []);

  return {
    prepareStems,
    mixFinalDub,
    buildDubAlignmentReport,
  };
};
