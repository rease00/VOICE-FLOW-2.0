import React from 'react';

interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardProps> = ({ children, className = '', ...props }) => {
  return (
    <div
      className={`vf-surface-card rounded-2xl border ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
