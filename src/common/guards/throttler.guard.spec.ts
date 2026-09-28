import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AstroidThrottlerGuard } from './throttler.guard';
import { DomainException } from '../exceptions/domain.exception';
import { THROTTLE_TIER_KEY } from '../decorators/throttle-tier.decorator';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ThrottlerOptions, ThrottlerRequest } from '@nestjs/throttler';
import { createThrottlerOptions, ThrottlerConfig } from '../../config/throttler.config';

describe('AstroidThrottlerGuard', () => {
  let guard: AstroidThrottlerGuard;
  let reflector: Reflector;
  let storageService: any;

  beforeEach(() => {
    reflector = new Reflector();
    storageService = {
      increment: jest.fn(),
    };
    guard = new AstroidThrottlerGuard(
      { throttlers: [], storage: storageService } as any,
      { get: () => {} } as any,
      reflector,
    );
    (guard as any).storageService = storageService;
  });

  it('should allow request when within limit', async () => {
    storageService.increment.mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    const req = { headers: {}, ip: '127.0.0.1' };
    const res = { header: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('api');

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(res.header).toHaveBeenCalledWith('X-RateLimit-Limit-api', expect.any(Number));
  });

  it('should throw DomainException when rate limit is exceeded', async () => {
    storageService.increment.mockResolvedValue({
      totalHits: 11,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 60,
    });

    const req = { headers: {}, ip: '127.0.0.1' };
    const res = { header: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('api');

    await expect(guard.canActivate(context)).rejects.toThrow(DomainException);
    expect(res.header).toHaveBeenCalledWith('Retry-After', 60);
  });
});


/** Shape returned by `ThrottlerStorage#increment` (not re-exported by the lib). */
type ThrottlerStorageRecord = Awaited<ReturnType<AstroidThrottlerGuard['storageService']['increment']>>;

const CONFIG: ThrottlerConfig = { windowSeconds: 60, apiLimit: 120, authLimit: 10 };

const UNBLOCKED: ThrottlerStorageRecord = {
  totalHits: 1,
  timeToExpire: 60,
  isBlocked: false,
  timeToBlockExpire: 0,
};

const BLOCKED: ThrottlerStorageRecord = {
  totalHits: 11,
  timeToExpire: 30,
  isBlocked: true,
  timeToBlockExpire: 30,
};

type MockResponse = { header: ReturnType<typeof vi.fn> };

function buildContext(request: Record<string, unknown> = { ip: '203.0.113.7', headers: {} }, response: MockResponse = { header: vi.fn() }) {
  const handler = () => undefined;
  return {
    getHandler: () => handler,
    getClass: () => class TransactionController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function throttlerNamed(name: string): ThrottlerOptions {
  return { name, ttl: 60_000, limit: 10 };
}

async function prepare(opts: { tier?: ThrottleTier; increment?: ReturnType<typeof vi.fn> } = {}) {
  const increment = opts.increment ?? vi.fn().mockResolvedValue(UNBLOCKED);
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => (key === THROTTLE_TIER_KEY ? opts.tier : undefined)),
  };
  const guard = new AstroidThrottlerGuard(
    createThrottlerOptions(CONFIG),
    { increment } as never,
    reflector as never,
  );
  await guard.onModuleInit();

  const response: MockResponse = { header: vi.fn() };
  const context = buildContext({ ip: '203.0.113.7', headers: {} }, response);
  const { getTracker, generateKey } = (
    guard as unknown as {
      commonOptions: Pick<ThrottlerRequest, 'getTracker' | 'generateKey'>;
    }
  ).commonOptions;

  const call = (throttler: ThrottlerOptions) =>
    guard['handleRequest']({
      context,
      limit: 10,
      ttl: 60_000,
      throttler,
      blockDuration: 60_000,
      getTracker,
      generateKey,
    } as ThrottlerRequest);

  return { guard, increment, reflector, context, response, call };
}