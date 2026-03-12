export type RuntimePollMode = 'none' | 'active' | 'cooldown';

export interface RuntimePollModeInput {
  nowMs: number;
  isBusy: boolean;
  activeUntilMs: number;
  cooldownUntilMs: number;
  hasSessionIdentity: boolean;
  isVisible: boolean;
  isLeader: boolean;
}

export const resolveRuntimePollMode = (input: RuntimePollModeInput): RuntimePollMode => {
  if (!input.hasSessionIdentity) return 'none';
  if (!input.isVisible) return 'none';
  if (!input.isLeader) return 'none';
  if (input.isBusy) return 'active';
  if (input.nowMs < input.activeUntilMs) return 'active';
  if (input.nowMs < input.cooldownUntilMs) return 'cooldown';
  return 'none';
};
