/**
 * All user-facing and spoken English text lives here (see docs/PLAN.md §5).
 */
export const strings = {
  appName: 'Alouna',
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
