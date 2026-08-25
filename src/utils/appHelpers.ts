/**
 * Application helper functions
 */

import api from '../api';
import { PriorityOption } from '../types';

/**
 * Checks if an error is related to instance status (suspended/inactive)
 * and updates the instance status state accordingly.
 *
 * @param error - The error object from an API call
 * @param setInstanceStatus - Function to update instance status state
 * @returns true if the error was an instance status error, false otherwise
 */
export const checkInstanceStatusOnError = async (
  error: any,
  setInstanceStatus: (status: {
    status: string;
    message: string;
    isDismissed: boolean;
  }) => void
): Promise<boolean> => {
  if (error?.response?.status === 503 && error?.response?.data?.code === 'INSTANCE_SUSPENDED') {
    // Update instance status state
    setInstanceStatus({
      status: error.response.data.status,
      message: error.response.data.message,
      isDismissed: false
    });
    return true; // Indicates this was an instance status error
  }
  
  // For any other API error, check if instance is still active
  if (error?.response?.status >= 500) {
    try {
      const response = await api.get('/auth/instance-status');
      if (!response.data.isActive) {
        setInstanceStatus({
          status: response.data.status,
          message: response.data.message,
          isDismissed: false
        });
      }
    } catch (statusError) {
      // If we can't check status, assume it's suspended
      setInstanceStatus({
        status: 'suspended',
        message: 'Unable to determine instance status',
        isDismissed: false
      });
    }
  }
  
  return false; // Not an instance status error
};

/**
 * Gets the default priority option from available priorities.
 *
 * @param availablePriorities - Array of available priority options
 * @returns The default priority option, or null when none are loaded
 */
export const getDefaultPriorityOption = (
  availablePriorities: PriorityOption[]
): PriorityOption | null => {
  // Find priority with initial = true (or 1 from SQLite)
  const defaultPriority = availablePriorities.find(p => !!p.initial);
  if (defaultPriority) {
    return defaultPriority;
  }

  // Fallback to lowest ID (first priority created) if no default set
  const lowestId = [...availablePriorities].sort((a, b) => a.id - b.id)[0];
  return lowestId || null;
};

/**
 * Gets the default priority name from available priorities.
 *
 * @param availablePriorities - Array of available priority options
 * @returns The name of the default priority, or 'medium' as fallback
 */
export const getDefaultPriorityName = (availablePriorities: PriorityOption[]): string => {
  // Ultimate fallback when priorities have not loaded yet
  return getDefaultPriorityOption(availablePriorities)?.priority || 'medium';
};

