/**
 * Utility functions for board management
 */

import { Board } from '../types';
import i18n from '../i18n/config';
import { normalizeAppLanguage } from './guestLanguage';

/**
 * Generates a unique board name by appending a number if the name already exists.
 * Uses Default application language (APP_LANGUAGE), not the current user's UI language.
 */
export const generateUniqueBoardName = (
  boards: Board[],
  appLanguage?: string | null
): string => {
  const lng = normalizeAppLanguage(appLanguage) || 'en';
  const baseName = i18n.t('boardTabs.newBoard', { ns: 'common', lng });
  let counter = 1;
  let proposedName = `${baseName} ${counter}`;
  
  while (boards.some(board => board.title.toLowerCase() === proposedName.toLowerCase())) {
    counter++;
    proposedName = `${baseName} ${counter}`;
  }
  
  return proposedName;
};

