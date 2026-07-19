// Grey mobile design tokens — light theme, mirrors web CSS variables
export const colors = {
  bg:          '#F4F3EE',
  surface:     '#FFFFFF',
  surface2:    '#F4F3EE',
  border:      '#ECEBE6',

  text:        '#16181C',
  textMuted:   '#8A8D91',

  accent:      '#3DDC84',
  accentSoft:  '#E8FBF0',
  accentText:  '#0B3D20',

  callout:     '#16181C',
  calloutText: '#FFFFFF',
  calloutMuted:'#A8ACB1',

  success:     '#1D9E75',
  successSoft: '#E8FBF0',
  warning:     '#854F0B',
  warningSoft: '#FEF3DD',
  danger:      '#791F1F',
  dangerSoft:  '#FCEBEB',

  // Check-in button
  ciButton:    '#3DDC84',
  ciDone:      '#1D9E75',
  ciText:      '#0B3D20',
} as const

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const

export const radius = {
  sm: 6, md: 10, lg: 16, xl: 20, full: 9999,
} as const

export const fontSize = {
  xs: 9, sm: 10, base: 12, md: 13, lg: 15, xl: 18, xxl: 24,
} as const
