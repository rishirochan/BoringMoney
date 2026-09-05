import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("boringmoney", {
  getVaultPath: () => ipcRenderer.invoke("vault:get-path"),
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  importFiles: (paths: string[]) => ipcRenderer.invoke("files:import", paths),
  listFiles: () => ipcRenderer.invoke("files:list"),
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getParsed: (id: string) => ipcRenderer.invoke("documents:parsed", id),
  renameDocument: (id: string, fileName: string) =>
    ipcRenderer.invoke("documents:rename", id, fileName),
  setDocumentAccount: (id: string, account: string) =>
    ipcRenderer.invoke("documents:set-account", id, account),
  deleteDocument: (id: string) => ipcRenderer.invoke("documents:delete", id),
  listTransactions: () => ipcRenderer.invoke("transactions:list"),
  exportTransactions: () => ipcRenderer.invoke("transactions:export"),
  getPlaidStatus: () => ipcRenderer.invoke("plaid:status"),
  getPlaidCredentials: () => ipcRenderer.invoke("plaid:credentials"),
  savePlaidCredentials: (credentials: {
    clientId: string;
    secret: string;
    environment: "sandbox" | "production";
  }) => ipcRenderer.invoke("plaid:save-credentials", credentials),
  connectPlaid: () => ipcRenderer.invoke("plaid:connect"),
  disconnectPlaid: (itemId: string) => ipcRenderer.invoke("plaid:disconnect", itemId),
  // Electron 44 removed File.path; webUtils.getPathForFile is the sync replacement.
  getFilePath: (file: File) => webUtils.getPathForFile(file),
});
