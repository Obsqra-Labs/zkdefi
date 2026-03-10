'use client';

export function Label({ children, htmlFor, className = '' }: any) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-medium text-gray-700 ${className}`}>
      {children}
    </label>
  );
}
