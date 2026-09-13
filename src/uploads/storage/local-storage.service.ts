import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from './storage.interface';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LocalStorageService implements StorageProvider {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'properties'): Promise<{ url: string; filename: string }> {
    const targetDir = path.join(this.uploadDir, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileExt = path.extname(file.originalname);
    const filename = `${uuidv4()}${fileExt}`;
    const filePath = path.join(targetDir, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const relativeUrl = `/uploads/${folder}/${filename}`;
    this.logger.log(`Uploaded file stored locally at ${relativeUrl}`);

    return {
      url: relativeUrl,
      filename,
    };
  }

  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      const relativePath = fileUrl.startsWith('/uploads/') ? fileUrl.replace('/uploads/', '') : fileUrl;
      const fullPath = path.join(this.uploadDir, relativePath);

      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Error deleting file '${fileUrl}':`, error);
      return false;
    }
  }
}
