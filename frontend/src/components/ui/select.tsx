'use client';

import React from 'react';

export function Select({ children }: any) {
  return <div>{children}</div>;
}

export function SelectTrigger({ children }: any) {
  return <button className="border border-gray-300 rounded px-3 py-2">{children}</button>;
}

export function SelectValue({ placeholder }: any) {
  return <span>{placeholder}</span>;
}

export function SelectContent({ children }: any) {
  return <div className="bg-white border border-gray-300 rounded shadow">{children}</div>;
}

export function SelectItem({ children, value }: any) {
  return <div className="px-3 py-2 hover:bg-gray-100">{children}</div>;
}
