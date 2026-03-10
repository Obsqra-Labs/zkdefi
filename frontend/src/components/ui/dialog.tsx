'use client';

import React, { useState } from 'react';

export function Dialog({ children, open = false, onOpenChange }: any) {
  return <div>{children}</div>;
}

export function DialogTrigger({ children, asChild }: any) {
  return <div>{children}</div>;
}

export function DialogContent({ children }: any) {
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">{children}</div>;
}

export function DialogHeader({ children }: any) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children }: any) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function DialogDescription({ children }: any) {
  return <p className="text-sm text-gray-600">{children}</p>;
}
