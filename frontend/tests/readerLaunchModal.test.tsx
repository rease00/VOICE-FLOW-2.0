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

  it('keeps the read action available while loading details', () => {
    const html = renderToStaticMarkup(
      <ReaderLaunchModal
        item={createItem()}
        resolveMediaUrl={() => ''}
        isLoading
        onClose={vi.fn()}
        onRead={vi.fn()}
      />
    );

    expect(html).toContain('Refreshing details from backend...');
    expect(html).toContain('Read');
    expect(html).not.toContain('Use Licensed Import');
  });

  it('falls back to cover text when no image url is available', () => {
    const html = renderToStaticMarkup(
      <ReaderLaunchModal
        item={createItem()}
        resolveMediaUrl={() => ''}
        onClose={vi.fn()}
        onRead={vi.fn()}
      />
    );

    expect(html).toContain('vf-reader-v2-cover__fallback');
    expect(html).toContain('Alice in Wonderland');
    expect(html).toContain('Lewis Carroll');
  });
});
