/**
 * Hook for managing modal state
 */

import { useCallback, useEffect, useState } from 'react';
import {
  clearHelpSession,
  loadHelpSession,
  saveHelpSession,
} from '../utils/helpSessionPersistence';

export type ProfileInitialFocus = 'displayName' | 'bio';

export interface UseModalStateReturn {
  showHelpModal: boolean;
  setShowHelpModal: (show: boolean) => void;
  /** Bumped whenever help is opened so a minimized Help modal expands (F1 / help button). */
  helpExpandToken: number;
  openHelpModal: () => void;
  closeHelpModal: () => void;
  showProfileModal: boolean;
  setShowProfileModal: (show: boolean) => void;
  /** Where to focus when Profile opens (reset to displayName on close). */
  profileInitialFocus: ProfileInitialFocus;
  openProfileModal: (focus?: ProfileInitialFocus) => void;
  closeProfileModal: () => void;
  isProfileBeingEdited: boolean;
  setIsProfileBeingEdited: (editing: boolean) => void;
}

export const useModalState = (userId?: string | null): UseModalStateReturn => {
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpExpandToken, setHelpExpandToken] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileInitialFocus, setProfileInitialFocus] =
    useState<ProfileInitialFocus>('displayName');
  const [isProfileBeingEdited, setIsProfileBeingEdited] = useState(false);

  // Restore Help open state after refresh for this user (sessionStorage only)
  useEffect(() => {
    if (!userId) {
      setShowHelpModal(false);
      return;
    }
    const saved = loadHelpSession(userId);
    setShowHelpModal(Boolean(saved?.open));
  }, [userId]);

  const persistOpen = useCallback(
    (open: boolean, minimized = false) => {
      if (!userId) return;
      const prev = loadHelpSession(userId);
      saveHelpSession(userId, {
        open,
        minimized: open ? (prev?.minimized ?? minimized) : false,
        activeTab: prev?.activeTab,
        scrollByTab: prev?.scrollByTab,
      });
    },
    [userId]
  );

  const openHelpModal = useCallback(() => {
    setShowHelpModal(true);
    setHelpExpandToken((n) => n + 1);
    persistOpen(true);
  }, [persistOpen]);

  const closeHelpModal = useCallback(() => {
    setShowHelpModal(false);
    if (userId) {
      clearHelpSession(userId);
    }
  }, [userId]);

  const openProfileModal = useCallback((focus: ProfileInitialFocus = 'displayName') => {
    setProfileInitialFocus(focus);
    setShowProfileModal(true);
  }, []);

  const closeProfileModal = useCallback(() => {
    setShowProfileModal(false);
    setProfileInitialFocus('displayName');
  }, []);

  return {
    showHelpModal,
    setShowHelpModal,
    helpExpandToken,
    openHelpModal,
    closeHelpModal,
    showProfileModal,
    setShowProfileModal,
    profileInitialFocus,
    openProfileModal,
    closeProfileModal,
    isProfileBeingEdited,
    setIsProfileBeingEdited,
  };
};
