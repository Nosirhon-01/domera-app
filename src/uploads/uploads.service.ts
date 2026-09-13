import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage.interface';

@Injectable()
export class UploadsService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  async uploadImage(file: Express.Multer.File, folder = 'properties') {
    if (!file) {
      throw new BadRequestException('No file provided for upload');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
    }

    // 5MB max file size validation
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds maximum limit of 5MB');
    }

    return this.storageProvider.uploadFile(file, folder);
  }

  async deleteFile(fileUrl: string) {
    return this.storageProvider.deleteFile(fileUrl);
  }
}
