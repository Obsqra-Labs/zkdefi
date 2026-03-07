'use client';

import React from 'react';

export function Input({
  type = 'text',
  value,
  onChange,
  placeholder = '',
  className = '',
  disabled = false,
  min,
  max,
  step,
}: {
  type?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      className={`px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    />
  );
}
