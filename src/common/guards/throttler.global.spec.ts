import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerOptions, ThrottlerRequest } from '@nestjs/throttler';
import { AstroidThrottlerGuard } from './throttler.guard';
import { createThrottlerOptions, ThrottlerConfig } from '../../config/throttler.config';

const CONFIG: ThrottlerConfig = { windowSeconds: 60, apiLimit: 120, authLimit: 10 };

type ThrottlerStorageRecord = Awaited<ReturnType<AstroidThrottlerGuard['storageService']['increment']>>;

const UNBLOCKED: ThrottlerStorageRecord = {
  totalHits: 1,
  timeToExpire: 60,
  isBlocked: false,
  timeToBlockExpire: 0,
};

const BLOCKED: ThrottlerStorageRecord = {
  totalHits: 121,
  timeToExpire: 30,
  isBlocked: true,
  timeToBlockExpire: 30,
};

describe('AstroidThrottlerGuard Global Integration & Rate Limit Guard', () => {
  let guard: AstroidThrottlerGuard;
  let incrementMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    incrementMock = vi.fn().mockResolvedValue(UNBLOCKED);
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    guard = new AstroidThrottlerGuard(
      createThrottlerOptions(CONFIG),
      { increment: incrementMock } as never,
      reflector as never,
    );
    await guard.onModuleInit();
  });

  it('should correctly count requests and allow traffic under limit', async () => {
    const response = { header: vi.fn() };
    const request = { ip: '127.0.0.1', headers: {} };
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    const { getTracker, generateKey } = (guard as unknown as { commonOptions: Pick<ThrottlerRequest, 'getTracker' | 'generateKey'> }).commonOptions;
    const throttler: ThrottlerOptions = { name: 'default', ttl: 60_000, limit: 120 };

    const result = await guard['handleRequest']({
      context,
      limit: 120,
      ttl: 60_000,
      throttler,
      blockDuration: 60_000,
      getTracker,
      generateKey,
    } as ThrottlerRequest);

    expect(result).toBe(true);
    expect(incrementMock).toHaveBeenCalled();
  });

  it('should block excess traffic when limit is exceeded', async () => {
    incrementMock.mockResolvedValue(BLOCKED);
    const response = { header: vi.fn() };
    const request = { ip: '127.0.0.1', headers: {} };
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    const { getTracker, generateKey } = (guard as unknown as { commonOptions: Pick<ThrottlerRequest, 'getTracker' | 'generateKey'> }).commonOptions;
    const throttler: ThrottlerOptions = { name: 'default', ttl: 60_000, limit: 120 };

    await expect(
      guard['handleRequest']({
        context,
        limit: 120,
        ttl: 60_000,
        throttler,
        blockDuration: 60_000,
        getTracker,
        generateKey,
      } as ThrottlerRequest),
    ).rejects.toThrow();
  });
});
