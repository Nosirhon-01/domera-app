import { Module } from '@nestjs/common';
import { PropertyImagesService } from './property-images.service';
import { PropertyImagesController } from './property-images.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [PropertyImagesController],
  providers: [PropertyImagesService],
  exports: [PropertyImagesService],
})
export class PropertyImagesModule {}
