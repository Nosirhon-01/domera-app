export interface StorageProvider {
  uploadFile(file: Express.Multer.File, folder?: string): Promise<{ url: string; filename: string }>;
  deleteFile(fileKey: string): Promise<boolean>;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
