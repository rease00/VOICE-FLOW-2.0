import { useMemo } from 'react';
import { useUser } from '../../../../contexts/UserContext';
import { firebaseConfigIssue, isFirebaseConfigured } from '../../../../services/firebaseClient';

export const useAuthSession = () => {
  const {
    user,
    isAuthenticated,
    isAdmin,
    hasUnlimitedAccess,
    signInWithEmail,
    signUpWithEmail,
    requestPasswordReset,
    signOutUser,
    signInWithGoogle,
    signInWithFacebook,
    startPhoneSignIn,
    confirmPhoneSignIn,
  } = useUser();

  return useMemo(() => ({
    user,
    isAuthenticated,
    isAdmin,
    hasUnlimitedAccess,
    isFirebaseConfigured,
    firebaseConfigIssue,
    signInWithEmail,
    signUpWithEmail,
    requestPasswordReset,
    signOutUser,
    signInWithGoogle,
    signInWithFacebook,
    startPhoneSignIn,
    confirmPhoneSignIn,
  }), [
    confirmPhoneSignIn,
    hasUnlimitedAccess,
    isAdmin,
    isAuthenticated,
    requestPasswordReset,
    signInWithEmail,
    signInWithFacebook,
    signInWithGoogle,
    signOutUser,
    signUpWithEmail,
    startPhoneSignIn,
    user,
  ]);
};
