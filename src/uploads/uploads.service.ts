import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage.interface';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// The stored file extension comes from the detected type, never from the client's file name,
// so a file named "x.html" with a fake image/png header cannot be served as HTML from /uploads.
const IMAGE_TYPES: { mime: string[]; ext: string; matches: (b: Buffer) => boolean }[] = [
  {
    mime: ['image/jpeg', 'image/jpg'],
    ext: '.jpg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: ['image/png'],
    ext: '.png',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: ['image/webp'],
    ext: '.webp',
    matches: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

@Injectable()
export class UploadsService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  async uploadImage(file: Express.Multer.File, folder = 'properties') {
    if (!file) {
      throw new BadRequestException('No file provided for upload');
    }

    const type = IMAGE_TYPES.find((t) => t.mime.includes(file.mimetype));
    if (!type) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
    }

    if (file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException('File size exceeds maximum limit of 5MB');
    }

    if (!type.matches(file.buffer)) {
      throw new BadRequestException('File content does not match its image type');
    }

    return this.storageProvider.uploadFile(file, folder, type.ext);
  }

  async deleteFile(fileUrl: string) {
    return this.storageProvider.deleteFile(fileUrl);
  }
}
