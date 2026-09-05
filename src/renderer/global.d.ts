declare module "*.css";

interface Window {
  boringmoney: {
    getVaultPath(): Promise<string | null>;
    chooseVault(): Promise<string | null>;
    importFiles(paths: string[]): Promise<{ name: string; ok: boolean; error?: string }[]>;
    listFiles(): Promise<{ name: string; size: number; importedAt: number }[]>;
    getFilePath(file: File): string;
  };
}
