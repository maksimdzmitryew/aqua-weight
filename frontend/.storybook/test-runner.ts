import type { TestRunnerConfig } from '@storybook/test-runner';

const config: TestRunnerConfig = {
  async preRender(page) {
    // Hook for pre-render setup (e.g., inject axe for accessibility)
  },
  async postRender(page) {
    // Hook for post-render checks
  },
};

export default config;
