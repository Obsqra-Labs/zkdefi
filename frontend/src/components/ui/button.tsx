'use client';

import React from 'react';

export function Button({
  children,
  onClick,
  className = '',
  disabled = false,
  variant = 'default',
  size = 'md',
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  variant?: string;
  size?: string;
}) {
  const sizeClasses = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  }[size] || 'px-4 py-2';

  const baseClasses = `${sizeClasses} rounded font-medium transition-colors`;
  const variantClasses =
    variant === 'outline'
      ? 'border border-gray-300 text-gray-900 hover:bg-gray-50'
      : 'bg-blue-600 text-white hover:bg-blue-700';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
