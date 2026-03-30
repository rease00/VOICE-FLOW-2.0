import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { VoicesWorkspace } from '../src/features/voices/VoicesWorkspace';
import type { CharacterProfile, VoiceOption } from '../types';

const voices: VoiceOption[] = [
  {
    id: 'voice_1',
    name: 'Aster US',
    gender: 'Female',
    accent: 'US',
    country: 'United States',
    geminiVoiceName: 'Aster',
    engine: 'PRIME',
  },
];

const characters: CharacterProfile[] = [
  {
    id: 'char_1',
    name: 'Narrator',
    voiceId: 'voice_1',
    gender: 'Female',
    age: 'Adult',
    avatarColor: '#6366f1',
  },
];

const baseProps = {
  backendBaseUrl: 'http://127.0.0.1:7800',
  selectedEngine: 'PRIME' as const,
  characterLibrary: characters,
  clonedVoices: voices,
  galleryVoicePool: voices,
  previewState: null,
  getVoiceById: (voiceId: string) => voices.find((voice) => voice.id === voiceId),
  createCharacterDraft: () => ({
    id: 'draft_1',
    name: '',
    voiceId: 'voice_1',
    gender: 'Unknown' as const,
    age: 'Adult',
    avatarColor: '#6366f1',
  }),
  onPreviewCharacter: vi.fn(async () => undefined),
  onPreviewVoice: vi.fn(async () => undefined),
  onSaveCharacter: vi.fn(),
  onDeleteCharacter: vi.fn(),
  onToast: vi.fn(),
  onRequireUpgrade: vi.fn(),
  resolveVoiceDisplayLabel: (voice: VoiceOption) => voice.name,
  resolveVoiceDisplayMeta: (voice: VoiceOption) => ({ name: voice.name, countryTag: 'US' }),
  resolveVoicePersonaLabel: () => 'Female Adult',
  resolveVoiceAccessTier: () => 'free' as const,
  resolveVoiceCountry: () => 'United States',
  isVoiceLockedForFreeTier: () => false,
};

describe('VoicesWorkspace', () => {
  it('renders desktop workspace framing', () => {
    const html = renderToStaticMarkup(
      <VoicesWorkspace
        {...baseProps}
        layoutMode="desktop"
      />
    );

    expect(html).toContain('data-voices-layout=\"desktop\"');
    expect(html).toContain('aria-orientation=\"vertical\"');
    expect(html).toContain('Library');
    expect(html).toContain('Clone');
    expect(html).toContain('Add Character');
    expect(html).toContain('Edit Character');
    expect(html).toContain('Delete Character');
    expect(html).toContain('1 clones');
    expect(html).not.toContain('Manage characters and voice assignments.');
    expect(html).not.toContain('Active mode</p><p class=\"vf-voices-mode-summary\">Cast');
  });

  it('renders stacked framing outside desktop', () => {
    const html = renderToStaticMarkup(
      <VoicesWorkspace
        {...baseProps}
        layoutMode="tablet"
      />
    );

    expect(html).toContain('data-voices-layout=\"stacked\"');
    expect(html).toContain('aria-orientation=\"horizontal\"');
    expect(html).toContain('Search voices');
    expect(html).toContain('All genders');
    expect(html).toContain('All countries');
  });

  it('uses compact copy on phones', () => {
    const html = renderToStaticMarkup(
      <VoicesWorkspace
        {...baseProps}
        layoutMode="phone"
      />
    );

    expect(html).toContain('data-voices-layout=\"stacked\"');
    expect(html).toContain('>Add</button>');
    expect(html).toContain('>Preview</button>');
    expect(html).toContain('>Edit</button>');
    expect(html).toContain('>Delete</button>');
    expect(html).not.toContain('>Add Character</button>');
  });
});
