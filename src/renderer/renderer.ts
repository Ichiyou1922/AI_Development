declare global {
  interface Window {
    electronAPI: {
      ping: () => string;
    };
  }
}

console.log('electronAPI.ping():', window.electronAPI.ping());