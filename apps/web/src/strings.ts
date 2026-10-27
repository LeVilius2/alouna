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
    tabs: {
      features: 'Features',
      selected: 'Edit item',
      rules: 'Rules',
      import: 'Import / Export',
      routes: 'Test route',
      account: 'Account & sync',
    },
    route: {
      heading: 'Route tester',
      hint: 'Choose A and B on the map or select point destinations, then calculate a route.',
      source: 'Routing map',
      approved: 'Approved map',
      preview: 'Editor preview',
      approvedHint:
        'Uses the last approved routing snapshot. Pending edits do not affect this test.',
      previewHint:
        'Preview only: includes unsynced edits and submissions awaiting review. This is not the navigator map.',
      unavailable: 'Routing data is unavailable or invalid. Load a valid map before testing.',
      noArea: 'No enabled walkable area. Enable and approve a plot before testing.',
      start: 'A · Start',
      end: 'B · End',
      pickStart: 'Pick A on map',
      pickEnd: 'Pick B on map',
      pickingStart: 'Click the map to place A. The next click will place B.',
      pickingEnd: 'Click the map to place B.',
      pointDestination: 'Choose a point destination',
      pointHint: 'Area and line destinations need an explicit point on the map.',
      coordinate: (p: readonly number[]) => `${p[0]!.toFixed(6)}, ${p[1]!.toFixed(6)}`,
      unset: 'Not set',
      calculate: 'Calculate route',
      calculating: 'Calculating route…',
      cancel: 'Cancel calculation',
      clear: 'Clear test',
      costs: 'Show cost grid',
      costHint:
        'Grid covers the current view when you calculate. Pan or zoom, then calculate again to refresh it.',
      viewport: (width: number, height: number) =>
        `Visible extent: ${width.toFixed(0)} × ${height.toFixed(0)} m`,
      gridSummary: (count: number, size: number) =>
        `Exact cost grid: ${count.toLocaleString('en-US')} cells at ${size} m.`,
      costLegend:
        'Red: blocked (including buffers). Green: preferred. Yellow: grass. Orange: higher cost. Clearance adds cost near obstacles.',
      zoomIn: (n: number) =>
        `This view contains ${n.toLocaleString('en-US')} cells. Zoom in and calculate again to show the exact grid.`,
      summary: (distance: number, cost: number, visited: number) =>
        `${distance.toFixed(1)} m · weighted cost ${cost.toFixed(1)} · ${visited.toLocaleString('en-US')} searched cells`,
      failed: 'The routing worker could not calculate this route. Check the map and try again.',
      failures: {
        'blocked-start': 'A is blocked and has no passable cell within the 2 m snap limit.',
        'blocked-end': 'B is blocked and has no passable cell within the 2 m snap limit.',
        'no-route':
          'No connected route exists between A and B under the current rules. Show the cost grid to inspect blocked cells and gaps in walkable areas.',
        'search-limit':
          'The search limit was reached. This does not prove that no route exists. Try closer endpoints or a smaller test area.',
      },
      why: 'Why no route?',
      endpointBlocked: (endpoint: string, blockers: string) =>
        `${endpoint}: blocked by ${blockers}. The red outline marks its grid cell.`,
      outside: 'outside the enabled walkable areas',
      snap: (endpoint: string, distance: number) =>
        `${endpoint} snapped ${distance.toFixed(1)} m to a passable cell. The dotted segment is unchecked; simulation starts and ends on the calculated route.`,
      events: 'Route events',
      noEvents: 'No annotated events on this route.',
      eventDistance: (m: number) => `At ${m.toFixed(1)} m`,
      turn: (direction: 'left' | 'right', angle: number) =>
        `Turn ${direction} ${angle.toFixed(0)}°`,
      enter: (label: string) => `Enter ${label}`,
      hazard: (label: string) => `Near ${label}`,
      crossing: 'Road crossing. Stop and listen.',
      simulator: 'Walk simulator',
      simulationHint: 'Virtual walk with live guidance and sonar audio.',
      audioEnabled: 'Play sonar & speech in simulator',
      play: 'Play walk',
      pause: 'Pause walk',
      reset: 'Reset walker',
      mode: 'Simulation mode',
      automatic: 'Follow route',
      manual: 'Manual movement',
      speed: 'Walking speed (m/s)',
      headingControl: 'Walker heading (degrees)',
      forward: 'Step forward 1 m',
      backward: 'Step back 1 m',
      left: 'Turn left 15°',
      right: 'Turn right 15°',
      keyboardHint:
        'Focus this pad. Up/down: move 1 m. Left/right: turn 15°. Manual movement may leave the route or cross blocked cells.',
      keyboardPad: 'Manual walker controls',
      progress: (walked: number, total: number) => `${walked.toFixed(1)} of ${total.toFixed(1)} m`,
      headingValue: (n: number) => `Heading ${n.toFixed(0)}°`,
      finished: 'Simulated walk finished.',
      mapLabel: 'Property map',
    },
    draw: {
      label: 'Drawing tools',
      pan: 'Pan',
      select: 'Select / vertices',
      point: 'Add point',
      circle: 'Add obstacle circle',
      line: 'Draw line',
      polygon: 'Draw area',
      newCategory: 'Category for new drawings',
      fitAll: 'Fit to map',
      undo: 'Undo',
      redo: 'Redo',
    },
    basemaps: {
      label: 'Basemap',
      orthophoto: 'Lithuania aerial (ORT10LT)',
      esri: 'Satellite (Esri)',
      osm: 'Street map (OSM)',
    },
    list: {
      filterCategory: 'All categories',
      showDisabled: 'Show disabled areas',
      showDeleted: 'Show deleted (restore)',
      needsReviewOnly: 'Needs review only',
      empty: 'No features match this filter.',
      plotsHeading: 'Walkable areas (plots)',
      itemsHeading: 'Map features',
      toggleVisibility: (label: string) => `Show ${label} on map`,
    },
    status: {
      approved: 'Approved',
      'pending-new': 'Needs review (new)',
      'pending-edit': 'Needs review (edited)',
      'pending-delete': 'Needs review (delete)',
      deleted: 'Deleted',
      queued: 'Unsynced',
      conflict: 'Conflict',
    },
    inspector: {
      noneSelected: 'Select an item on the map or in the list, or use a drawing tool to add one.',
      name: 'Name',
      spokenName: 'Spoken name (TTS)',
      category: 'Category',
      width: 'Width (m)',
      radius: 'Radius (m)',
      owner: 'Owner / plot label',
      destination: 'Offer as a navigation destination',
      enabled: 'Enabled on the map',
      notes: 'Notes',
      source: 'Source',
      revision: (rev: number) => `Revision ${rev}`,
      createdBy: (who: string) => `Added by ${who}`,
      gpsAccuracy: (m: number) => `GPS accuracy ±${m.toFixed(1)} m`,
      save: 'Save changes',
      approve: 'Approve & publish',
      delete: 'Delete',
      restore: 'Restore',
      discardLocal: 'Discard conflicting local changes',
      revertGeometry: 'Reset shape',
      readOnlyWalker: 'Only an administrator or the person who added this item can edit it.',
      saved: 'Change queued.',
    },
    rules: {
      heading: 'Category routing rules',
      readOnly: 'Only an administrator can change routing rules.',
      passable: 'Passable',
      cost: 'Cost multiplier',
      buffer: 'Safety buffer (m)',
      warn: 'Warning distance (m, blank = none)',
      priority: 'Priority',
      color: 'Colour',
      overrides: 'Overrides (comma-separated categories)',
      save: 'Save rule',
      saved: 'Rule update queued.',
    },
    importExport: {
      importHeading: 'Import features',
      fileLabel: 'Choose file (GeoJSON, KML, GPX, CSV)',
      pasteLabel: 'Or paste GeoJSON, KML, GPX or coordinates',
      format: 'Format',
      crs: 'Coordinate system',
      crsOptions: {
        auto: 'Auto-detect',
        wgs84: 'WGS84 [longitude, latitude]',
        'wgs84-latlon': 'WGS84 [latitude, longitude]',
        lks94: 'LKS94 (EPSG:3346) [easting, northing]',
        'lks94-ne': 'LKS94 (EPSG:3346) [northing, easting]',
      },
      join: 'CSV / text rows represent',
      joinOptions: {
        points: 'Separate points',
        line: 'One line',
        polygon: 'One closed area',
      },
      defaultCategory: 'Assign category',
      previewCount: (n: number, crs: string | null) =>
        `${n} feature${n === 1 ? '' : 's'} ready${crs ? ` (${crs})` : ''}.`,
      importButton: (n: number) => `Import ${n} feature${n === 1 ? '' : 's'}`,
      imported: (n: number) => `Queued ${n} imported feature${n === 1 ? '' : 's'}.`,
      exportHeading: 'Export backup',
      exportHint: 'Download all current features and category rules as GeoJSON.',
      exportButton: 'Download GeoJSON backup',
    },
  },
  navigator: {
    title: 'Navigator',
    placeholder: 'Audio navigation will be built in milestone M5.',
    back: 'Back',
    whereTo: 'Where to?',
    repeatLast: (name: string) => `Repeat last: ${name}`,
    startTo: (name: string) => `Start walking to ${name}`,
    distanceAway: (meters: number) => `${Math.round(meters)} m away`,
    distanceUnknown: 'Distance waiting for GPS',
    noDestinations:
      'No destinations are available on the approved map yet. Add a point destination in the map editor.',
    noWalkableArea: 'No enabled walkable area on the approved map. Guidance is unavailable.',
    signInRequired:
      'Sign in once while online to download the approved map for offline navigation.',
    settingsButton: 'Audio & compass settings',
    closeSettings: 'Back to destinations',
    simToggle: 'Use simulated walker (indoor test mode)',
    simControlsLabel: 'Simulated walker controls',
    simPlay: 'Auto-walk route',
    simPause: 'Pause auto-walk',
    simStepForward: 'Step forward 2 m',
    simTurnLeft: 'Turn left 20°',
    simTurnRight: 'Turn right 20°',
    simStepOffRoute: 'Step 6 m off route',
    simWeakGps: 'Simulate weak GPS (±25 m)',
    simGoodGps: 'Restore good GPS (±2 m)',
    navigatingTo: (name: string) => `Navigating to ${name}`,
    stopButton: 'Stop navigation',
    stopHint: 'Stops audio sonar and returns to destination list',
    whereAmIButton: 'Where am I?',
    whereAmIHint: 'Spoken nearest landmark, remaining distance, and GPS quality',
    repeatButton: 'Repeat instruction',
    repeatHint: 'Repeats the last spoken navigation prompt',
    statusCalculating: 'Calculating route…',
    statusGuiding: (remainingM: number, turnDegrees: number) => {
      const rounded = Math.round(remainingM);
      if (Math.abs(turnDegrees) <= 10) return `${rounded} m remaining · On course`;
      const dir = turnDegrees > 0 ? 'right' : 'left';
      return `${rounded} m remaining · Turn ${dir} ${Math.round(Math.abs(turnDegrees))}°`;
    },
    statusWeakGps: 'GPS weak, stop and wait.',
    statusRecalculating: 'Recalculating route…',
    statusArrived: (name: string) => `Arrived at ${name}.`,
    statusRouteFailed: (reason: string) => `Cannot guide: ${reason}`,
    gpsBadge: (accuracyM: number | null) =>
      accuracyM !== null ? `GPS ±${Math.round(accuracyM)} m` : 'Waiting for GPS fix…',
    headingBadge: (degrees: number | null) =>
      degrees !== null ? `Heading ${Math.round(degrees)}°` : 'Waiting for compass…',
    batteryBadge: (percent: number) => `Battery ${percent}%`,
    settings: {
      heading: 'Settings & safety tips',
      voiceLocale: 'Speech voice',
      localeEnUs: 'English (US)',
      localeEnGb: 'English (UK)',
      speechRate: 'Speech rate',
      sonarVolume: 'Sonar volume',
      declination: 'Magnetic declination (°)',
      iosHaptics: 'iOS 18 switch haptic ticks (experimental)',
      testSonar: 'Test sonar ping',
      testSpeech: 'Test voice',
      safetyTipsHeading: 'iPhone & safety checklist',
      safetyTipHeadphones:
        'Use bone-conduction headphones (such as Shokz) so you still hear cars, water, and people.',
      safetyTipHoldFlat:
        'Hold the phone flat in your hand with the top edge pointing straight ahead.',
      safetyTipScreenOn:
        'Keep the screen unlocked and Alouna in the foreground. locking the screen stops GPS and audio.',
      safetyTipBattery:
        'Screen + GPS + audio uses battery quickly. Lower screen brightness before a walk.',
    },
    spoken: {
      start: (name: string, distanceM: number, snapM: number | null) =>
        snapM && snapM >= 0.5
          ? `To ${name}, ${Math.round(distanceM)} meters. Note: route starts ${Math.round(snapM)} meters from your current GPS position. Proceed carefully.`
          : `To ${name}, ${Math.round(distanceM)} meters.`,
      batteryNotice: (percent: number) => `Battery ${percent} percent.`,
      weakGps: 'GPS weak, stop and wait.',
      gpsRestored: 'GPS signal restored. Continue.',
      recalculating: 'Recalculating.',
      pausedBackground: 'Navigation paused. Recalculating.',
      stopped: 'Navigation stopped.',
      arrived: (name: string) => `Arrived at ${name}.`,
      turn: (direction: 'left' | 'right', angleDegrees: number) =>
        angleDegrees >= 135 ? 'Turn around.' : `Turn ${direction}.`,
      crossing: 'Road crossing. Stop and listen.',
      steps: 'Steps ahead.',
      caution: 'Caution area ahead.',
      enter: (label: string) => `${label} ahead.`,
      hazard: (label: string, distanceM: number, sector: 'ahead' | 'left' | 'right' | 'behind') => {
        const dist = Math.max(1, Math.round(distanceM));
        const unit = dist === 1 ? 'meter' : 'meters';
        return `${label}, ${dist} ${unit}, ${sector}.`;
      },
      whereAmI: (landmarkText: string, remainingM: number | null, accuracyM: number | null) => {
        const parts = [landmarkText];
        if (remainingM !== null) {
          parts.push(`${Math.round(remainingM)} meters remaining.`);
        }
        if (accuracyM !== null) {
          parts.push(`GPS accuracy plus or minus ${Math.round(accuracyM)} meters.`);
        } else {
          parts.push('No GPS fix yet.');
        }
        return parts.join(' ');
      },
      nearestLandmark: (
        name: string,
        distanceM: number,
        sector: 'ahead' | 'left' | 'right' | 'behind',
      ) => {
        const dist = Math.round(distanceM);
        if (dist <= 1) return `At ${name}.`;
        return `Near ${name}, ${dist} meters ${sector}.`;
      },
      noLandmark: 'No named landmark nearby.',
      noInstructionYet: 'Waiting for route guidance.',
      routeBlockedStart:
        'Your current position is in a blocked area or outside the walkable property. Stop and ask for assistance.',
      routeBlockedEnd: 'That destination is currently blocked. Guidance stopped.',
      routeNotFound: 'No safe route found to that destination. Guidance stopped.',
      voiceTestSample: 'Alouna audio navigation ready.',
    },
  },
  notFound: 'Page not found.',
} as const;
