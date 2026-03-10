'use client';

import React, { useState } from 'react';

export function TooltipProvider({ children }: any) {
  return <div>{children}</div>;
}

export function Tooltip({ children }: any) {
  const [showTooltip, setShowTooltip] = useState(false);
  return <div>{children}</div>;
}

export function TooltipTrigger({ children, ...props }: any) {
  return (
    <div {...props} onMouseEnter={() => {}} onMouseLeave={() => {}}>
      {children}
    </div>
  );
}

export function TooltipContent({ children }: any) {
  return (
    <div className="absolute z-50 rounded bg-gray-900 px-2 py-1 text-xs text-white">
      {children}
    </div>
  );
}
