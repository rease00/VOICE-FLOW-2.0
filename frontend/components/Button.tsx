import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-xl border font-medium transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-200 backdrop-blur-xl focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  const variants = {
    primary:
      'border-transparent bg-gradient-to-r from-cyan-400 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_36px_rgba(8,14,32,0.24)] hover:-translate-y-0.5 hover:brightness-105 focus:ring-cyan-300/40',
    secondary:
      'border-white/10 bg-white/[0.06] text-slate-100 shadow-[0_12px_26px_rgba(2,6,23,0.18)] hover:border-white/20 hover:bg-white/[0.1] focus:ring-white/20',
    ghost:
      'border-transparent bg-transparent text-slate-200 hover:bg-white/[0.08] hover:text-white focus:ring-white/20',
    danger:
      'border-rose-400/20 bg-rose-500/12 text-rose-100 shadow-[0_12px_26px_rgba(127,29,29,0.18)] hover:bg-rose-500/18 focus:ring-rose-300/30',
  };

  const sizes = {
    sm: 'min-h-11 px-3 text-xs',
    md: 'min-h-11 px-4 text-sm',
    lg: 'min-h-12 px-6 text-base',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="mr-2 animate-spin" size={size === 'sm' ? 12 : 16} />}
      {!isLoading && icon && <span className="mr-2">{icon}</span>}
      {children}
    </button>
  );
};
