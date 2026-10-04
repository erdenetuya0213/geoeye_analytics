/**
 * The demo workspace (mock project and fixture data) exists for sales
 * demonstrations only. It is never offered, in development or production,
 * unless the build explicitly opts in with VITE_ENABLE_DEMO=true.
 */
export const demoWorkspaceAllowed: boolean = import.meta.env.VITE_ENABLE_DEMO === 'true'
