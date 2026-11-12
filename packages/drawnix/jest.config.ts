/* eslint-disable */
export default {
  displayName: 'drawnix',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // *.test.* files use Vitest and run through the root vitest.config.ts.
  testPathIgnorePatterns: ['/node_modules/', '\\.test\\.[jt]sx?$'],
  coverageDirectory: '../../coverage/packages/drawnix',
};
