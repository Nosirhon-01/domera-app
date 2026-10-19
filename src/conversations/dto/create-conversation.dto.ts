import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({
    description: 'ID of the other participant (e.g. agent UUID)',
    example: 'some-uuid-here',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  participantId: string;
}
