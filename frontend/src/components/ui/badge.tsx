'use client';

import React from 'react';

export function Badge({ children, className = '', variant = 'default' }: any) {
  const baseClasses = 'inline-block px-2 py-1 text-xs font-semibold rounded-full';
  const variantClasses = variant === 'outline' ? 'border border-gray-300' : 'bg-blue-100 text-blue-800';

  return <span className={`${baseClasses} ${variantClasses} ${className}`}>{children}</span>;
}
