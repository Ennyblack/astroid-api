import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AstroidThrottlerGuard } from './throttler.guard';
import { ErrorCode } from '../constants/error-codes';
import { DomainException } from '../exceptions/domain.exception';

describe('AstroidThrottlerGuard Unit Tests', () => {
  let guard: AstroidThrottlerGuard;
  let storage: any;
  let reflector: any;

  beforeEach(() => {
    storage = {
      increment: vi.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60000,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('api'),
    };

    guard = new AstroidThrottlerGuard(
      { throttlers: [{ name: 'api', ttl: 60000, limit: 10 }] } as any,
      storage,
      reflector,
    );
  });

  it('should allow requests under the limit and set rate limit headers', async () => {
    const response = { header: vi.fn() };
    const context = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1', headers: {} }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    const throttler = { name: 'api', ttl: 60000, limit: 10 };
    const res = await (guard as any).handleRequest({
      context,
      limit: 10,
      ttl: 60000,
      throttler,
      blockDuration: 60000,
      getTracker: async () => 'ip:127.0.0.1',
      generateKey: () => 'key',
    });

    expect(res).toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    expect(response.header).toHaveBeenCalledWith('X-RateLimit-Limit-api', 10);
    expect(response.header).toHaveBeenCalledWith('X-RateLimit-Remaining-api', 9);
  });

  it('should throw DomainException with RATE_LIMITED when limit is exceeded', async () => {
    storage.increment.mockResolvedValue({
      totalHits: 11,
      timeToExpire: 60000,
      isBlocked: true,
      timeToBlockExpire: 30000,
    });

    const response = { header: vi.fn() };
    const context = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1', headers: {} }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    const throttler = { name: 'api', ttl: 60000, limit: 10 };
    await expect(
      (guard as any).handleRequest({
        context,
        limit: 10,
        ttl: 60000,
        throttler,
        blockDuration: 60000,
        getTracker: async () => 'ip:127.0.0.1',
        generateKey: () => 'key',
      }),
    ).rejects.toThrowError(DomainException);

    expect(response.header).toHaveBeenCalledWith('Retry-After', 30);
  });
});
