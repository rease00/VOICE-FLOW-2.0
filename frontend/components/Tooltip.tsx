import React, { useState, useRef } from 'react';

export interface TooltipProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ title, children, className, placement = 'top' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const show = () => setIsVisible(true);
  const hide = () => setIsVisible(false);

  return (
    <div
      ref={triggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ display: 'inline-block' }}
    >
      {children}
      {isVisible && (
        <div
          className={`fixed z-50 px-3 py-2 text-xs text-white rounded-lg shadow-lg max-w-xs ${
            placement === 'top'
              ? 'bottom-10 left-1/2 -translate-x-1/2'
              : placement === 'bottom'
              ? 'top-10 left-1/2 -translate-x-1/2'
              : placement === 'left'
              ? 'right-10 top-1/2 -translate-y-1/2'
              : 'left-10 top-1/2 -translate-y-1/2'
          }`}
          style={{
            background: 'rgba(0, 0, 0, 0.9)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          {title}
        </div>
      )}
    </div>
  );
};