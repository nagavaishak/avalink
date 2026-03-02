/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // AvaLink dark theme
        background: '#0A0E1A',
        surface: '#131929',
        card: '#1A2235',
        border: '#1F2D45',
        // Avalanche red
        primary: '#E84142',
        'primary-dark': '#B53132',
        'primary-light': '#FF5C5D',
        // Status colors
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
        // Text
        'text-primary': '#FFFFFF',
        'text-secondary': '#8B9AB2',
        'text-muted': '#4A5568',
        // BLE indicator
        ble: '#8B5CF6',
      },
      fontFamily: {
        mono: ['Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
