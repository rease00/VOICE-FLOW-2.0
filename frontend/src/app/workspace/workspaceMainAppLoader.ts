const loadLegacyMainApp = () => import('./MainApp').then((module) => module.MainApp);

export const preloadWorkspaceMainApp = (): void => {
  void loadLegacyMainApp();
};

export { loadLegacyMainApp };
