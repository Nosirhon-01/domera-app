import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from './storage.interface';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class LocalStorageService implements StorageProvider {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'properties',
    extension?: string,
  ): Promise<{ url: string; filename: string }> {
    const targetDir = this.resolveInsideUploads(folder);
    if (!targetDir) {
      throw new Error(`Invalid upload folder '${folder}'`);
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileExt = extension ?? path.extname(file.originalname);
    const filename = `${randomUUID()}${fileExt}`;
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
      const fullPath = this.resolveInsideUploads(relativePath);
      if (!fullPath) {
        this.logger.warn(`Refusing to delete path outside uploads directory: '${fileUrl}'`);
        return false;
      }

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Error deleting file '${fileUrl}':`, error);
      return false;
    }
  }

  /** Resolve a path under uploads/ and reject anything that escapes it (e.g. "../../.env"). */
  private resolveInsideUploads(relativePath: string): string | null {
    const fullPath = path.resolve(this.uploadDir, relativePath);
    return fullPath.startsWith(this.uploadDir + path.sep) ? fullPath : null;
  }
}
