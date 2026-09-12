/** Version of the JS bundle that is running (not the pod that answered an API call). */
export const BUILD_VERSION =
  typeof __AGILA_BUILD_VERSION__ !== 'undefined' && __AGILA_BUILD_VERSION__
    ? __AGILA_BUILD_VERSION__
    : 'dev';
