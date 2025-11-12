/***** Jest configuration for Vite React app *****/
const path = require('path')

module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: [
    '<rootDir>/src/setupTests.js',
  ],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    // Mock CSS modules
    '^.+\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // Handle assets
    '^.+\\.(jpg|jpeg|png|gif|webp|svg)$': path.join(__dirname, '__mocks__/fileMock.js'),
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/main.jsx',
  ],
}