import { contextBridge, ipcRenderer } from "electron";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength = 200): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

contextBridge.exposeInMainWorld("plaidLink", {
  complete(publicToken: unknown, metadata: unknown) {
    if (typeof publicToken !== "string" || !publicToken || publicToken.length > 512) return;
    const source = isObject(metadata) ? metadata : {};
    const institution = isObject(source.institution) ? source.institution : {};
    const accounts = Array.isArray(source.accounts)
      ? source.accounts.slice(0, 100).flatMap((value) => {
          if (!isObject(value)) return [];
          const id = optionalString(value.id);
          const name = optionalString(value.name);
          if (!id || !name) return [];
          return [{
            id,
            name,
            mask: optionalString(value.mask, 16),
            type: optionalString(value.type, 50),
            subtype: optionalString(value.subtype, 80),
          }];
        })
      : [];
    ipcRenderer.send("plaid-link:success", {
      publicToken,
      institutionName: optionalString(institution.name) ?? "Connected bank",
      accounts,
    });
  },
  exit(message: unknown) {
    ipcRenderer.send("plaid-link:exit", optionalString(message, 500));
  },
});
