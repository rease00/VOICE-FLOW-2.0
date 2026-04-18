import React from 'react';
import { AdminPanel } from '../../../../components/AdminPanel';

interface AdminTabContentProps {
  adminApiBaseUrl: string;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onRefreshEntitlements: () => Promise<void>;
  initialOpsTab?: 'usage' | 'tokens' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics' | 'accounting';
}

export const AdminTabContent: React.FC<AdminTabContentProps> = ({
  adminApiBaseUrl,
  onToast,
  onRefreshEntitlements,
  initialOpsTab,
}) => {
  return (
    <AdminPanel
      adminApiBaseUrl={adminApiBaseUrl}
      onToast={onToast}
      onRefreshEntitlements={onRefreshEntitlements}
      {...(initialOpsTab ? { initialOpsTab } : {})}
    />
  );
};

