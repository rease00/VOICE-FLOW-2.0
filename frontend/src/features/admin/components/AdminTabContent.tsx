import React from 'react';
import { AdminPanel } from '../../../../components/AdminPanel';

interface AdminTabContentProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onRefreshEntitlements: () => Promise<void>;
  initialOpsTab?: 'usage' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics';
}

export const AdminTabContent: React.FC<AdminTabContentProps> = ({
  mediaBackendUrl,
  onToast,
  onRefreshEntitlements,
  initialOpsTab,
}) => {
  return (
    <AdminPanel
      mediaBackendUrl={mediaBackendUrl}
      onToast={onToast}
      onRefreshEntitlements={onRefreshEntitlements}
      {...(initialOpsTab ? { initialOpsTab } : {})}
    />
  );
};
