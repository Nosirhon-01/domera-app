import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { STORAGE_PROVIDER } from './storage/storage.interface';
import { LocalStorageService } from './storage/local-storage.service';

@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: STORAGE_PROVIDER,
      useClass: LocalStorageService,
    },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
