import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { THROTTLE_TIER_KEY, ThrottleTier } from '../decorators/throttle-tier.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { ErrorCode } from '../constants/error-codes';
import { DomainException } from '../exceptions/domain.exception';

@Injectable()
export class AstroidThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration, getTracker, generateKey } = requestProps;
    const tracker = await getTracker(context.switchToHttp().getRequest());
    const key = generateKey(context, tracker, throttler.name);
    const tier = this.reflector.getAllAndOverride<ThrottleTier>(THROTTLE_TIER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'api';

    if (throttler.name !== tier) {
      return true;
    }

    const response = context.switchToHttp().getResponse();
    const storageService = this.storageService;
    const ttlMs = typeof ttl === 'function' ? ttl() : ttl;
    const blockDurationMs = typeof blockDuration === 'function' ? blockDuration() : blockDuration;

    const totalHits = await storageService.increment(key, ttlMs, limit, blockDurationMs, throttler.name);
    
    const timeToExpire = totalHits.timeToExpire;
    const remaining = Math.max(0, limit - totalHits.totalHits);

    response.header(`X-RateLimit-Limit-${throttler.name}`, limit);
    response.header(`X-RateLimit-Remaining-${throttler.name}`, remaining);
    response.header(`X-RateLimit-Reset-${throttler.name}`, Math.ceil(Date.now() / 1000) + timeToExpire);

    if (totalHits.isBlocked) {
      response.header('Retry-After', totalHits.timeToBlockExpire);
      throw new DomainException(ErrorCode.RATE_LIMITED, 'Rate limit exceeded', {
        limit,
        ttl,
        retryAfter: totalHits.timeToBlockExpire,
      });
    }

    return true;
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as AuthenticatedUser | undefined;
    if (user?.organizationId) {
      return `org:${user.organizationId}`;
    }
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.ip ?? 'anonymous';
    return `ip:${ip}`;
  }
}
