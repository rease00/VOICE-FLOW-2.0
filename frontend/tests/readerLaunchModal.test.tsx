import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReaderLaunchModal } from '../src/features/reader/components/ReaderLaunchModal';
import type { ReaderCatalogItem } from '../types';

const createItem = (): ReaderCatalogItem => ({
  id: 'novel-1',
  title: 'Alice in Wonderland',
  author: 'Lewis Carroll',
  regionId: 'english',
  contentKind: 'book',
  surface: 'books',
  provider: 'wikimedia',
  license: 'public-domain',
  summary: 'Alice follows a rabbit into a strange world.',
});

describe('reader launch modal', () => {
  it('renders summary and read action before launch', () => {
    const html = renderToStaticMarkup(
      <ReaderLaunchModal
        item={createItem()}
        resolveMediaUrl={() => ''}
        onClose={vi.fn()}
        onRead={vi.fn()}
      />
    );

    expect(html).toContain('Before You Read');
    expect(html).toContain('Alice in Wonderland');
    expect(html).toContain('Read');
    expect(html).toContain('Alice follows a rabbit into a strange world.');
  });

  it('renders policy guidance and blocks read label when commercial status is blocked', () => {
    const html = renderToStaticMarkup(
      <ReaderLaunchModal
        item={createItem()}
        resolveMediaUrl={() => ''}
        commercialCheck={{
          result: 'blocked',
          reason: 'Provider is blocked by strict policy.',
          provider: 'project_gutenberg',
          licenseToken: 'public-domain',
          ownershipBasis: 'user_responsible',
          intendedUse: 'tts_transform_only',
          isSellingOriginalText: false,
          catalogAllowed: false,
          notes: [],
          nextSteps: ['Use imported content with explicit rights.'],
        }}
        onClose={vi.fn()}
        onRead={vi.fn()}
      />
    );

    expect(html).toContain('Commercial: BLOCKED');
    expect(html).toContain('Use Licensed Import');
  });
});
