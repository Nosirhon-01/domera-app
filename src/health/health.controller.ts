import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check application and database health' })
  @ApiResponse({ status: 200, description: 'Application and database are up' })
  @ApiResponse({ status: 503, description: 'Database is unreachable' })
  async check(@Res({ passthrough: true }) res: Response) {
    const health = await this.healthService.checkHealth();
    // Non-200 lets PM2/uptime monitors and load balancers detect a broken DB connection
    if (health.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
