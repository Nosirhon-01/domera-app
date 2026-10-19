import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsQueryDto } from './dto/agents-query.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: AgentsQueryDto) {
    const { page = 1, limit = 20, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      role: Role.AGENT,
      isActive: true,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, agents] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
          bio: true,
          createdAt: true,
          _count: {
            select: {
              properties: true,
            },
          },
        },
      }),
    ]);

    const items = agents.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      avatar: a.avatar,
      bio: a.bio,
      createdAt: a.createdAt,
      propertiesCount: a._count.properties,
    }));

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const agent = await this.prisma.user.findFirst({
      where: { id, role: Role.AGENT, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        bio: true,
        createdAt: true,
        _count: {
          select: {
            properties: true,
          },
        },
      },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      avatar: agent.avatar,
      bio: agent.bio,
      createdAt: agent.createdAt,
      propertiesCount: agent._count.properties,
    };
  }
}
