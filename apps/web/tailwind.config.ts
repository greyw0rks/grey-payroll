import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:           '#F4F3EE',
        surface:      '#FFFFFF',
        'surface-2':  '#F4F3EE',
        border:       '#ECEBE6',
        text:         '#16181C',
        'text-muted': '#8A8D91',
        accent:       '#3DDC84',
        'accent-soft':'#E8FBF0',
        'accent-text':'#0B3D20',
        callout:      '#16181C',
        'callout-text':'#FFFFFF',
        'callout-muted':'#A8ACB1',
        success:      '#1D9E75',
        'success-soft':'#E8FBF0',
        warning:      '#854F0B',
        'warning-soft':'#FEF3DD',
        danger:       '#791F1F',
        'danger-soft': '#FCEBEB',
      },
      fontFamily: {
        display: ['var(--font-sora)',   'ui-sans-serif', 'system-ui'],
        body:    ['var(--font-inter)',  'ui-sans-serif', 'system-ui'],
        mono:    ['var(--font-jbmono)','ui-monospace',  'SFMono-Regular'],
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}

export default config
