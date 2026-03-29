export type RuntimePollMode = 'none' | 'active' | 'cooldown';

export interface RuntimePollModeInput {
  nowMs: number;
  isBusy: boolean;
  activeUntilMs: number;
  cooldownUntilMs: number;
  isVisible: boolean;
  isLeader: boolean;
}

export const resolveRuntimePollMode = (input: RuntimePollModeInput): RuntimePollMode => {
  if (!input.isVisible) return 'none';
  if (!input.isLeader) return 'none';
  if (input.isBusy) return 'active';
  if (input.nowMs < input.activeUntilMs) return 'active';
  if (input.nowMs < input.cooldownUntilMs) return 'cooldown';
  return 'none';
};
