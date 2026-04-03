import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReaderUtilityTray } from './ReaderUtilityTray';

const noop = () => undefined;

describe('ReaderUtilityTray', () => {
  it('renders the consolidated settings, scripts, and saved audio tabs', () => {
    const markup = renderToStaticMarkup(
      <ReaderUtilityTray
        mode="novel"
        tabs={['read', 'settings', 'scripts', 'saved']}
        activeTab="saved"
        tabBadges={{ settings: 'Cast on', scripts: '1/1', saved: 'Ready' }}
        sourceLanguage="en"
        targetLanguage="en"
        playbackLanguage="en"
        translationPreview="Preview text"
        translationSupported
        multiSpeakerEnabled
        isCastModeEnabled
        ambienceSoundEnabled={false}
        narratorVoiceId="voice-1"
        speed={1}
        ambiencePreset="m_none"
        stylePreset="default"
        voiceSettingsDirty={false}
        castSettingsDirty={false}
        isSavingVoiceSettings={false}
        isSavingCastAssignments={false}
        backgroundPrepLimitValue={1000}
        backgroundPrepLimitUnit="chars"
        voiceOptions={[]}
        detectedSpeakers={['Alice']}
        castDraft={{ Alice: 'voice-1' }}
        textDraft="Detected text"
        activeText="Detected text"
        scriptSegments={[{ id: 'segment-1', title: 'Chapter 1', body: 'A line of text', status: 'ready', index: 0, charCount: 15 }]}
        currentUnitTitle="Chapter 1"
        savepointDownloadUrl="/reader/sessions/session-1/export"
        textDirty={false}
        canInstallReaderApp
        isReaderAppInstalled={false}
        readerAppInstallHint="Install Reader shortcut for offline mode."
        savedAudioEntries={[{
          id: 'saved-1',
          title: 'Chapter 1',
          unitLabel: 'Chapter 1',
          sessionId: 'session-1',
          unitId: 'unit-1',
          sourceJobId: 'job-1',
          speakerMode: 'single-speaker',
          mediaType: 'audio/wav',
          sizeBytes: 1024,
          createdAtMs: 1710000000000,
          watermark: { mode: 'invisible', enforced: true },
        }]}
        isSavingOfflineAudio={false}
        onChangeTab={noop}
        onToggleMultiSpeaker={noop}
        onToggleCastMode={noop}
        onToggleAmbienceSound={noop}
        onNarratorVoiceChange={noop}
        onSpeedChange={noop}
        onAmbiencePresetChange={noop}
        onStylePresetChange={noop}
        onCastDraftChange={noop}
        onBackgroundPrepLimitValueChange={noop}
        onBackgroundPrepLimitUnitChange={noop}
        onSaveVoiceSettings={noop}
        onSaveCastAssignments={noop}
        onSourceLanguageChange={noop}
        onTargetLanguageChange={noop}
        onPlaybackLanguageChange={noop}
        onTextDraftChange={noop}
        onApplyTextEdit={noop}
        onResetTextEdit={noop}
        onInstallReaderApp={noop}
        onSaveCurrentToLibrary={noop}
        onPlaySavedAudio={noop}
        onDownloadSavedAudio={noop}
        onDeleteSavedAudio={noop}
      />
    );

    expect(markup).toContain('Settings');
    expect(markup).toContain('Scripts');
    expect(markup).toContain('Saved Audio');
    expect(markup).toContain('data-reader-tab="saved"');
    expect(markup).toContain('Save to Library');
    expect(markup).toContain('single-speaker');
  });
});
