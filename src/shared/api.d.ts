export {};

declare global {
  interface Window {
    api: {
      app: {
        ping: () => Promise<string>;
        getVersion: () => Promise<string>;
      };
    };
  }
}
