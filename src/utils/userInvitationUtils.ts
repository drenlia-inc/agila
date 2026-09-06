/**
 * Utility functions for user invitation
 */

import i18n from '../i18n/config';
import { createUser } from '../api';

/**
 * Generates first and last name from an email address
 * @param email - The email address to generate names from
 * @returns An object with firstName and lastName
 */
export const generateNameFromEmail = (email: string): { firstName: string; lastName: string } => {
  // Generate names from email (before @ symbol)
  const emailPrefix = email.split('@')[0];
  const nameParts = emailPrefix.split(/[._-]/);
  
  // Capitalize first letter of each part
  let firstName = nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : 'User';
  let lastName = nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : 'User';
  
  // Special handling for common email prefixes
  if (emailPrefix.toLowerCase() === 'info') {
    firstName = 'Info';
    lastName = 'User';
  } else if (emailPrefix.toLowerCase() === 'admin') {
    firstName = 'Admin';
    lastName = 'User';
  } else if (emailPrefix.toLowerCase() === 'support') {
    firstName = 'Support';
    lastName = 'User';
  } else if (emailPrefix.toLowerCase() === 'noreply') {
    firstName = 'System';
    lastName = 'User';
  } else if (nameParts.length === 1) {
    // If only one part, use it as first name and "User" as last name
    firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
    lastName = 'User';
  }
  
  return { firstName, lastName };
};

/**
 * Handles user invitation process
 * @param email - The email address of the user to invite
 * @param handleRefreshData - Function to refresh data after user creation
 * @returns Promise that resolves when invitation is complete
 * @throws Error if invitation fails
 */
export const handleInviteUser = async (
  email: string,
  handleRefreshData: () => Promise<void>,
  boardIds: string[] = []
): Promise<void> => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  try {
    if (process.env.DEMO_ENABLED === 'true') {
      throw new Error(i18n.t('navigation.inviteDisabledDemo'));
    }

    // Check email server status first
    const emailStatusResponse = await fetch('/api/admin/email-status', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });
    
    if (emailStatusResponse.ok) {
      const emailStatus = await emailStatusResponse.json();
      if (!emailStatus.available) {
        if (
          emailStatus.demoMode === true ||
          String(emailStatus.error || '').toLowerCase().includes('demo')
        ) {
          throw new Error(i18n.t('navigation.inviteDisabledDemo'));
        }
        throw new Error(
          i18n.t('navigation.emailServerUnavailable', {
            error: emailStatus.error || emailStatus.message || '',
          })
        );
      }
    } else {
      console.warn('Could not check email status, proceeding with invitation');
    }

    // Generate names from email
    const { firstName, lastName } = generateNameFromEmail(normalizedEmail);
    
    // Generate a temporary password (user will change it during activation)
    const tempPassword = crypto.randomUUID().substring(0, 12);
    
    const result = await createUser({
      email: normalizedEmail,
      password: tempPassword,
      firstName,
      lastName,
      role: 'user',
      boardIds,
    });
    
    // Check if email was actually sent
    if (result.emailSent === false) {
      throw new Error(
        i18n.t('navigation.userCreatedButEmailFailed', {
          error: result.emailError || 'Email service unavailable',
        })
      );
    }
    
    // Refresh members list to show the new user
    await handleRefreshData();
  } catch (error: any) {
    console.error('Failed to invite user:', error);
    
    // Extract more specific error message
    let errorMessage = i18n.t('navigation.failedToSendInvitation');
    
    if (error.response?.data?.error) {
      const backendError = error.response.data.error;
      if (/already exists/i.test(String(backendError))) {
        errorMessage = i18n.t('navigation.userAlreadyExists', { email: normalizedEmail });
      } else if (backendError.includes('required')) {
        errorMessage = i18n.t('navigation.missingRequiredInfo');
      } else if (backendError.includes('email')) {
        errorMessage = i18n.t('navigation.invalidEmailFormat');
      } else if (
        String(backendError).toLowerCase().includes('demo') ||
        error.response?.data?.demoMode === true
      ) {
        errorMessage = i18n.t('navigation.inviteDisabledDemo');
      } else {
        errorMessage = backendError;
      }
    } else if (error.message) {
      if (/already exists/i.test(String(error.message))) {
        errorMessage = i18n.t('navigation.userAlreadyExists', { email: normalizedEmail });
      } else {
        errorMessage = error.message;
      }
    }
    
    throw new Error(errorMessage);
  }
};
