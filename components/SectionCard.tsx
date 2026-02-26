import React from 'react';

interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardProps> = ({ children, className = '', ...props }) => {
  return (
    <div
      className={`vf-surface-card bg-white rounded-2xl shadow-sm border border-gray-200 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
