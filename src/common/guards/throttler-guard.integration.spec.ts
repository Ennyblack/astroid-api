import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import { AstroidThrottlerGuard } from './throttler.guard';
import { createThrottlerOptions } from '../../config/throttler.config';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../exceptions/domain.exception';
import { ErrorCode } from '../constants/error-codes';

describe('Throttler Guard Integration', () => {
  let app: TestingModule;
  let guard: AstroidThrottlerGuard;

  beforeEach(async () => {
    const mockConfig = {
      get: vi.fn().mockImplementation((key, defaultVal) => {
        if (key === 'throttler') {
          return { windowSeconds: 60, apiLimit: 2, authLimit: 2 };
        }
        return defaultVal;
      }),
    };

    app = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => createThrottlerOptions(config),
        }),
      ],
      providers: [
        AstroidThrottlerGuard,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    guard = app.get<AstroidThrottlerGuard>(AstroidThrottlerGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should block requests exceeding the rate limit and throw DomainException with RATE_LIMITED', async () => {
    const req = { ip: '127.0.0.1', headers: {} };
    const res = { header: vi.fn() };
    const context = {
      getHandler: () => () => {},
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    // Make requests up to the limit and beyond
    const throttlers = [{ name: 'api', ttl: 60000, limit: 1 }];

    // First request should pass
    const res1 = await guard.handleRequest({
      context,
      limit: 1,
      ttl: 60000,
      throttler: throttlers[0],
      blockDuration: 60000,
      getTracker: async () => 'ip:127.0.0.1',
      generateKey: async () => 'key',
    } as never);
    expect(res1).toBe(true);

    // Second request should exceed limit and throw RATE_LIMITED
    await expect(
      guard.handleRequest({
        context,
        limit: 1,
        ttl: 60000,
        throttler: throttlers[0],
        blockDuration: 60000,
        getTracker: async () => 'ip:127.0.0.1',
        generateKey: async () => 'key',
      } as never),
    ).rejects.toThrowError(DomainException);
  });
});
