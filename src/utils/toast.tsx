import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

class ToastManager {
  private toasts: Toast[] = [];
  private listeners: ((toasts: Toast[]) => void)[] = [];
  private container: HTMLElement | null = null;
  private dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.createContainer();
  }

  private createContainer() {
    // Create a container that's above everything else
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      padding: 1rem;
      gap: 0.5rem;
    `;
    document.body.appendChild(this.container);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.toasts]));
  }

  subscribe(listener: (toasts: Toast[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private defaultDurationForType(type: ToastType): number {
    // Errors / warnings stay longer so users can read and dismiss them
    if (type === 'error' || type === 'warning') return 10000;
    return 3000;
  }

  show(toast: Omit<Toast, 'id'>) {
    const id = Math.random().toString(36).substr(2, 9);
    const duration =
      toast.duration !== undefined ? toast.duration : this.defaultDurationForType(toast.type);
    const newToast: Toast = {
      id,
      duration,
      type: toast.type,
      title: toast.title,
      message: toast.message,
      actionLabel: toast.actionLabel,
      onAction: toast.onAction,
    };

    this.toasts.push(newToast);
    this.notifyListeners();

    // Auto-dismiss after duration (skip if duration is 0 for persistent toasts)
    if (duration && duration > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, duration);
      this.dismissTimers.set(id, timer);
    }

    return id;
  }

  dismiss(id: string) {
    const timer = this.dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.dismissTimers.delete(id);
    }
    this.toasts = this.toasts.filter(toast => toast.id !== id);
    this.notifyListeners();
  }

  dismissAll() {
    this.dismissTimers.forEach((timer) => clearTimeout(timer));
    this.dismissTimers.clear();
    this.toasts = [];
    this.notifyListeners();
  }

  // Convenience methods
  success(title: string, message: string, duration?: number) {
    return this.show({ type: 'success', title, message, duration });
  }

  error(title: string, message: string, duration?: number) {
    return this.show({ type: 'error', title, message, duration });
  }

  warning(title: string, message: string, duration?: number) {
    return this.show({ type: 'warning', title, message, duration });
  }

  info(title: string, message: string, duration?: number) {
    return this.show({ type: 'info', title, message, duration });
  }
}

// Global toast manager instance
export const toast = new ToastManager();

// Toast component
export const ToastComponent: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast: toastData, onDismiss }) => {
  const { t } = useTranslation('common');
  const getToastStyles = () => {
    switch (toastData.type) {
      case 'success':
        return {
          bg: 'bg-green-50 dark:bg-green-900',
          border: 'border-green-200 dark:border-green-700',
          icon: 'text-green-400',
          title: 'text-green-800 dark:text-green-200',
          message: 'text-green-700 dark:text-green-300',
          button: 'text-green-400 hover:text-green-600 dark:text-green-500 dark:hover:text-green-400'
        };
      case 'error':
        return {
          bg: 'bg-red-50 dark:bg-red-900',
          border: 'border-red-200 dark:border-red-700',
          icon: 'text-red-400',
          title: 'text-red-800 dark:text-red-200',
          message: 'text-red-700 dark:text-red-300',
          button: 'text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400'
        };
      case 'warning':
        return {
          bg: 'bg-yellow-50 dark:bg-yellow-900',
          border: 'border-yellow-200 dark:border-yellow-700',
          icon: 'text-yellow-400',
          title: 'text-yellow-800 dark:text-yellow-200',
          message: 'text-yellow-700 dark:text-yellow-300',
          button: 'text-yellow-400 hover:text-yellow-600 dark:text-yellow-500 dark:hover:text-yellow-400'
        };
      case 'info':
        return {
          bg: 'bg-blue-50 dark:bg-blue-900',
          border: 'border-blue-200 dark:border-blue-700',
          icon: 'text-blue-400',
          title: 'text-blue-800 dark:text-blue-200',
          message: 'text-blue-700 dark:text-blue-300',
          button: 'text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-400'
        };
    }
  };

  const getIcon = () => {
    switch (toastData.type) {
      case 'success':
        return (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'error':
        return (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'info':
        return (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const styles = getToastStyles();

  return (
    <div 
      className={`${styles.bg} ${styles.border} rounded-lg shadow-lg p-4 max-w-sm pointer-events-auto animate-in slide-in-from-top-2 duration-300`}
      role="alert"
    >
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <div className={styles.icon}>
            {getIcon()}
          </div>
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-sm font-medium ${styles.title}`}>
            {toastData.title}
          </h3>
          {toastData.message ? (
            <p className={`mt-1 text-sm ${styles.message}`}>
              {toastData.message}
            </p>
          ) : null}
          {toastData.actionLabel && toastData.onAction ? (
            <button
              type="button"
              onClick={() => {
                toastData.onAction?.();
                onDismiss(toastData.id);
              }}
              className={`mt-2 inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${styles.title} ${styles.border} hover:opacity-90`}
            >
              {toastData.actionLabel}
            </button>
          ) : null}
        </div>
        <div className="ml-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => onDismiss(toastData.id)}
            className={`inline-flex rounded p-0.5 ${styles.button}`}
            aria-label={t('buttons.dismiss')}
          >
            <span className="sr-only">{t('buttons.dismiss')}</span>
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// Toast container component
export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  React.useEffect(() => {
    const unsubscribe = toast.subscribe(setToasts);
    return unsubscribe;
  }, []);

  const container = document.getElementById('toast-container');
  if (!container) return null;

  return createPortal(
    <>
      {toasts.map(toastData => (
        <ToastComponent
          key={toastData.id}
          toast={toastData}
          onDismiss={toast.dismiss.bind(toast)}
        />
      ))}
    </>,
    container
  );
};
