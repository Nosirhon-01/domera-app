import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { AgentsQueryDto } from './dto/agents-query.dto';

@ApiTags('Agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all active agents/sellers (Public)',
    description:
      'Returns a paginated list of active agents. No authentication required. Sensitive fields (password, tokens) are never exposed.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by agent name or email' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of agents',
    schema: {
      example: {
        data: {
          items: [
            {
              id: 'uuid',
              name: 'Test Agent',
              email: 'agent.test@domera.uz',
              phone: '+998901234567',
              avatar: null,
              bio: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              propertiesCount: 3,
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
        statusCode: 200,
        message: 'Success',
      },
    },
  })
  findAll(@Query() query: AgentsQueryDto) {
    return this.agentsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single agent by ID (Public)',
    description: 'Returns agent profile without sensitive data.',
  })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent profile' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  findOne(@Param('id') id: string) {
    return this.agentsService.findOne(id);
  }
}
