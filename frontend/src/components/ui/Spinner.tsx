"use client";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-8 h-8" };

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <div
      className={`border-2 border-emerald-500 border-t-transparent rounded-full animate-spin ${sizes[size]} ${className}`}
    />
  );
}

interface ErrorAlertProps {
  message: string;
  className?: string;
  onRetry?: () => void;
}

export function ErrorAlert({ message, className = "", onRetry }: ErrorAlertProps) {
  return (
    <div className={`rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-center justify-between ${className}`}>
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-2 text-red-300 hover:text-white text-xs underline">
          Retry
        </button>
      )}
    </div>
  );
}
