interface ElectronAPI {
  ping: () => string;
}

interface Window {
  electronAPI: ElectronAPI;
}