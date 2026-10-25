/**
 * All user-facing and spoken English text lives here (see docs/PLAN.md §5).
 */
export const strings = {
  appName: 'Alouna',
  data: {
    title: 'Map data',
    notConfigured: 'The map data connection is not configured yet.',
    signInHint:
      'Sign in with your email and password to save the approved map for offline use. Ask the administrator to create an account or reset a forgotten password.',
    email: 'Email address',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signInFailed:
      'Sign-in failed. Check your email, password and connection, or contact the administrator.',
    signOut: 'Sign out',
    confirmSignOut: (count: number) => `Sign out and discard ${count} pending changes`,
    loading: 'Loading approved map data…',
    ready: 'Approved map data is saved for offline use.',
    offline: 'Offline. Using the last approved map saved on this device.',
    admin: 'Administrator',
    walker: 'Walker',
    pending: (count: number) => `${count} pending changes`,
    version: (version: string) => `Approved map version ${version}`,
    cached: (when: string) => `Saved on this device: ${when}`,
    disabled: ' (disabled)',
    sync: 'Sync now',
    reviewConflicts:
      'Some changes need review before they can sync. They have not changed the approved routing map.',
    errors: {
      offline: 'Connection unavailable. Pending changes are saved on this device.',
      conflict: 'A map item changed elsewhere. Review the conflicting changes before retrying.',
      denied:
        'Map access is unavailable. Sign in again or contact the administrator. Guidance must stop.',
      'invalid-data': 'Map data could not be validated. Guidance must stop until this is fixed.',
    },
  },
  home: {
    tagline: 'Audio navigation around the lake property',
    openNavigator: 'Navigator',
    openNavigatorHint: 'Audio guidance for walking',
    openEditor: 'Map editor',
    openEditorHint: 'Draw and edit the map, test routes, see live users',
  },
  editor: {
    title: 'Map editor',
    placeholder: 'The map editor will be built in milestone M3.',
  },
  navigator: {
    title: 'Navigator',
    placeholder: 'Audio navigation will be built in milestone M5.',
    back: 'Back',
  },
  notFound: 'Page not found.',
} as const;
