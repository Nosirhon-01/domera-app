import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({
    description: 'Message text content. Cannot be empty or whitespace only.',
    example: 'Assalomu alaykum, bu obyekt hali sotuvdami?',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Message content cannot be empty' })
  @MaxLength(5000, { message: 'Message content cannot exceed 5000 characters' })
  content: string;
}
