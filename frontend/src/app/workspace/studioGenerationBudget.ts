import type { StudioQueueItem } from '../../../types';

export interface StudioGenerationBudgetCheck {
  allowed: boolean;
  estimatedCost: number;
  shortfall: number;
  spendableBalance: number;
  vfRate: number;
  charCount: number;
}

const roundStudioVfAmount = (value: number): number => (
  Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
);

export const estimateStudioGenerationVfCost = (charCount: number, vfRate: number): number => (
  roundStudioVfAmount(Math.max(0, Number(charCount) || 0) * Math.max(0, Number(vfRate) || 0))
);

export const checkStudioGenerationBudget = (input: {
  charCount: number;
  vfRate: number;
  spendableBalance: number;
  hasUnlimitedAccess: boolean;
}): StudioGenerationBudgetCheck => {
  const charCount = Math.max(0, Number(input.charCount) || 0);
  const vfRate = Math.max(0, Number(input.vfRate) || 0);
  const spendableBalance = Math.max(0, Number(input.spendableBalance) || 0);
  const estimatedCost = estimateStudioGenerationVfCost(charCount, vfRate);
  const shortfall = input.hasUnlimitedAccess
    ? 0
    : roundStudioVfAmount(Math.max(0, estimatedCost - spendableBalance));

  return {
    allowed: Boolean(input.hasUnlimitedAccess || shortfall <= 0),
    estimatedCost,
    shortfall,
    spendableBalance,
    vfRate,
    charCount,
  };
};

export const getBillableStudioQueueItems = (items: StudioQueueItem[]): StudioQueueItem[] => (
  items.filter((item) => {
    if (item.status === 'completed') return false;
    if (item.status === 'running' && String(item.jobId || '').trim()) return false;
    return item.charCount > 0;
  })
);

export const checkStudioQueueBudget = (input: {
  items: StudioQueueItem[];
  vfRate: number;
  spendableBalance: number;
  hasUnlimitedAccess: boolean;
}): StudioGenerationBudgetCheck & {
  itemCount: number;
} => {
  const billableItems = getBillableStudioQueueItems(input.items);
  const totalCharCount = billableItems.reduce((sum, item) => sum + Math.max(0, Number(item.charCount) || 0), 0);
  const base = checkStudioGenerationBudget({
    charCount: totalCharCount,
    vfRate: input.vfRate,
    spendableBalance: input.spendableBalance,
    hasUnlimitedAccess: input.hasUnlimitedAccess,
  });

  return {
    ...base,
    itemCount: billableItems.length,
  };
};
