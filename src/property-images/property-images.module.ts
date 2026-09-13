import { Module } from '@nestjs/common';
import { PropertyImagesService } from './property-images.service';
import { PropertyImagesController } from './property-images.controller';

@Module({
  controllers: [PropertyImagesController],
  providers: [PropertyImagesService],
  exports: [PropertyImagesService],
})
export class PropertyImagesModule {}
