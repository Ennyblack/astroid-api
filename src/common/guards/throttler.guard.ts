import {
  ExecutionContext,
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage, ThrottlerRequest } from '@nestjs/throttler';
import { Request } from 'express';
import { createHash } from 'crypto';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { THROTTLE_TIER_KEY, ThrottleTier } from '../decorators/throttle-tier.decorator';
import { extractApiKeyFromRequest } from '../helpers/extract-api-key';
import { DomainException } from '../exceptions/domain.exception';
import { ErrorCode } from '../constants/error-codes';

@Injectable()
export class AstroidThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AstroidThrottlerGuard.name);

  constructor(
    @Inject(ThrottlerModuleOptions.name) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storage: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const request = req as Request & { user?: AuthenticatedUser };
    const organizationId = request.user?.organizationId;
    if (organizationId) {
      return `org:${organizationId}`;
    }

    const apiKey = extractApiKeyFromRequest(request);
    if (apiKey) {
      return `key:${createHash('sha256').update(apiKey).digest('hex')}`;
    }

    const forwarded = request.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? request.ip ?? 'anonymous';
    return `ip:${ip}`;
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration, getTracker, generateKey } = requestProps;
    const tier = this.reflector.getAllAndOverride<ThrottleTier>(THROTTLE_TIER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'api';

    if (throttler.name !== tier) {
      return true;
    }

    const tracker = await getTracker(requestProps.context.switchToHttp().getRequest());
    const key = generateKey(context, tracker, throttler.name);
    const ttlMs = typeof ttl === 'function' ? ttl() : ttl;
    const limitCount = typeof limit === 'function' ? limit() : limit;
    const blockMs = typeof blockDuration === 'function' ? blockDuration() : blockDuration;

    const response = context.switchToHttp().getResponse();

    try {
      const result = await this.storageService.increment(key, ttlMs, limitCount, blockMs, throttler.name);
      const remaining = Math.max(0, limitCount - result.totalHits);
      response.header(`X-RateLimit-Limit-${throttler.name}`, limitCount);
      response.header(`X-RateLimit-Remaining-${throttler.name}`, remaining);
      response.header(`X-RateLimit-Reset-${throttler.name}`, Math.ceil(result.timeToExpire / 1000));

      if (result.isBlocked) {
        response.header('Retry-After', Math.ceil(result.timeToBlockExpire / 1000));
        throw new DomainException(ErrorCode.RATE_LIMITED, 'Rate limit exceeded', {
          limit: limitCount,
          retryAfter: Math.ceil(result.timeToBlockExpire / 1000),
        });
      }

      return true;
    } catch (error) {
      if (error instanceof DomainException && error.code === ErrorCode.RATE_LIMITED) {
        throw error;
      }
      this.logger.error(`Throttler storage error, failing open: ${(error as Error).message}`);
      response.header(`X-RateLimit-Limit-${throttler.name}`, limitCount);
      response.header(`X-RateLimit-Remaining-${throttler.name}`, limitCount);
      return true;
    }
  }
}
