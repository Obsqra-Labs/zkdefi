export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // in milliseconds
}

let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

function notify() {
  toastListeners.forEach((listener) => listener([...toasts]));
}

export function subscribe(listener: (toasts: Toast[]) => void) {
  toastListeners.push(listener);
  return () => {
    toastListeners = toastListeners.filter((l) => l !== listener);
  };
}

export function getToasts(): Toast[] {
  return [...toasts];
}

export function toast(
  type: ToastType,
  message: string,
  options?: { action?: Toast["action"]; duration?: number }
): string {
  const id = Math.random().toString(36).substring(2, 9);
  const newToast: Toast = {
    id,
    type,
    message,
    action: options?.action,
    duration: options?.duration ?? 5000,
  };

  toasts.push(newToast);
  notify();

  if (newToast.duration && newToast.duration > 0) {
    setTimeout(() => {
      dismiss(id);
    }, newToast.duration);
  }

  return id;
}

export function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function dismissAll() {
  toasts = [];
  notify();
}

// Convenience functions
export const toastSuccess = (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
  toast("success", message, options);
export const toastError = (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
  toast("error", message, options);
export const toastInfo = (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
  toast("info", message, options);
export const toastWarning = (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
  toast("warning", message, options);
