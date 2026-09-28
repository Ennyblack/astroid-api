import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DomainException } from '../exceptions/domain.exception';
import { ErrorCode } from '../constants/error-codes';

@Injectable()
import { Reflector } from '@nestjs/core';

@Injectable()
export class AstroidThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(context: ExecutionContext): Promise<void> {
    throw new DomainException(
      ErrorCode.RATE_LIMITED,
      'Rate limit exceeded. Please try again later.',
      429,
    );
  }
}
