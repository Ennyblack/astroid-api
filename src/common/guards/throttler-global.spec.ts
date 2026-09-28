import { describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AstroidThrottlerGuard } from './throttler.guard';
import { createThrottlerOptions } from '../../config/throttler.config';
import { throttlerConfig } from '../../config/throttler.config';

describe('Global Throttler Integration', () => {
  it('should register ThrottlerModule and AstroidThrottlerGuard globally', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [throttlerConfig],
        }),
        ThrottlerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: createThrottlerOptions,
        }),
      ],
      providers: [
        {
          provide: APP_GUARD,
          useClass: AstroidThrottlerGuard,
        },
      ],
    }).compile();

    const throttlerGuard = module.get<AstroidThrottlerGuard>(APP_GUARD);
    expect(throttlerGuard).toBeDefined();
    expect(throttlerGuard).toBeInstanceOf(AstroidThrottlerGuard);
  });
});
