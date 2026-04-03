import { describe, expect, it } from 'vitest';
import ReaderWorkspaceReaderPage from '../../../app/(app)/app/reader/page';
import ReaderWorkspaceReaderSlugPage from '../../../app/(app)/app/reader/[...slug]/page';
import { ReaderWorkspaceRouteScreen } from './ReaderWorkspaceRouteScreen';

describe('Reader workspace route pages', () => {
  it('exports the shared workspace route screen from the app-level reader page', () => {
    expect(ReaderWorkspaceReaderPage).toBe(ReaderWorkspaceRouteScreen);
  });

  it('exports the shared workspace route screen from the reader deep-link page', () => {
    expect(ReaderWorkspaceReaderSlugPage).toBe(ReaderWorkspaceRouteScreen);
  });
});
