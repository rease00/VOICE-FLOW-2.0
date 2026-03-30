export type VoicesWorkspaceMode = 'library' | 'clone';

export type VoicesInspectorPriority =
  | 'character'
  | 'voice'
  | 'clone-result'
  | 'stem-result'
  | 'diagnostics';

export interface VoicesWorkspaceViewState {
  mode: VoicesWorkspaceMode;
  selectedCharacterId: string;
  selectedVoiceId: string;
  inspectorPriority: VoicesInspectorPriority;
  diagnosticsExpanded: boolean;
}

export const resolveVoicesWorkspaceMode = (value: unknown): VoicesWorkspaceMode => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'library') return 'library';
  if (token === 'clone') return 'clone';
  return 'library';
};

export const resolveVoicesInspectorPriority = (
  value: unknown,
  fallback: VoicesInspectorPriority = 'voice'
): VoicesInspectorPriority => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'voice') return 'voice';
  if (token === 'clone-result') return 'clone-result';
  if (token === 'stem-result') return 'stem-result';
  if (token === 'diagnostics') return 'diagnostics';
  if (token === 'character') return 'character';
  return fallback;
};

export interface DeriveVoicesInspectorPriorityInput {
  mode: VoicesWorkspaceMode;
  hasSelectedCharacter: boolean;
  hasSelectedVoice: boolean;
  hasCloneResult: boolean;
  hasStemResult: boolean;
  diagnosticsExpanded: boolean;
}

export const deriveVoicesInspectorPriority = (
  input: DeriveVoicesInspectorPriorityInput
): VoicesInspectorPriority => {
  if (input.diagnosticsExpanded) return 'diagnostics';
  if (input.mode === 'clone') {
    if (input.hasStemResult) return 'stem-result';
    if (input.hasCloneResult) return 'clone-result';
    return 'clone-result';
  }
  return 'voice';
};

export const resolveVoicesSelectionId = (
  preferredId: string,
  candidateIds: string[]
): string => {
  const safePreferred = String(preferredId || '').trim();
  if (safePreferred && candidateIds.includes(safePreferred)) return safePreferred;
  return candidateIds[0] || '';
};
