import { Controller, Post, Get, Patch, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors } from '../common/swagger/api-responses';
import {
  AuthSessionResponseDto,
  ProfileUpdateResponseDto,
  RegisterCodeResponseDto,
  RegisterVerifyResponseDto,
  UserResponseDto,
} from './dto/auth-responses.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { RegisterCompleteDto, RegisterRequestCodeDto, RegisterVerifyCodeDto } from './dto/registration.dto';
import { RegistrationService } from './registration/registration.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Per client IP. Set AUTH_RATE_LIMIT to tune; refresh gets 3x the budget.
const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT) || 10;
const AUTH_RATE_TTL_MS = 60_000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
  ) {}

  // Brute-force protection: limited attempts per client IP
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @ApiOperation({
    summary: 'Register with email + password (role is always USER)',
    description: 'Phone numbers must be verified first: use /auth/register/request-code → verify-code → complete.',
  })
  @ApiEnvelope(201, 'User registered and signed in', AuthSessionResponseDto)
  @ApiErrors(
    [400, 'Validation error, or phone given (use the phone registration flow)'],
    [409, 'Email already registered'],
    [429, 'Too many attempts'],
  )
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email or phone + password' })
  @ApiEnvelope(200, 'Login successful', AuthSessionResponseDto)
  @ApiErrors([400, 'Validation error'], [401, 'Invalid credentials or deactivated account'], [429, 'Too many attempts'])
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register/request-code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 1: create a 6-digit registration code for a new phone number',
    description:
      'No SMS is sent. With OTP_DEV_MODE=true (never in production) the code is returned as devCode. ' +
      'Code valid 180 s, 60 s between codes, 5 codes per hour per number; a new code invalidates the previous one.',
  })
  @ApiEnvelope(200, 'Code created', RegisterCodeResponseDto)
  @ApiErrors(
    [400, 'Invalid phone number'],
    [409, 'Phone number already registered'],
    [429, 'Resend cooldown or hourly limit (body.retryAfter + Retry-After header), or IP limit'],
  )
  requestRegistrationCode(@Body() dto: RegisterRequestCodeDto) {
    return this.registrationService.requestCode(dto);
  }

  @Post('register/verify-code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2: check the 6-digit code',
    description: 'Returns a one-time verificationToken valid 10 minutes. 5 wrong attempts lock the code.',
  })
  @ApiEnvelope(200, 'Phone verified', RegisterVerifyResponseDto)
  @ApiErrors(
    [400, 'Wrong, expired, already used or not requested code; too many wrong attempts'],
    [429, 'Too many attempts from this IP'],
  )
  verifyRegistrationCode(@Body() dto: RegisterVerifyCodeDto) {
    return this.registrationService.verifyCode(dto);
  }

  @Post('register/complete')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @ApiOperation({
    summary: 'Step 3: set the password and create the account',
    description: 'Consumes the verificationToken. Tokens work with /auth/refresh like the ones from /auth/login.',
  })
  @ApiEnvelope(201, 'User registered and signed in', AuthSessionResponseDto)
  @ApiErrors(
    [400, 'Validation error, passwords do not match, or invalid/expired/used verification token'],
    [409, 'Phone number already registered'],
    [429, 'Too many attempts from this IP'],
  )
  completeRegistration(@Body() dto: RegisterCompleteDto) {
    return this.registrationService.complete(dto);
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT * 3, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT access token using refresh token' })
  @ApiEnvelope(200, 'New token pair (the old refresh token is revoked)', AuthSessionResponseDto)
  @ApiErrors([401, 'Invalid, expired or revoked refresh token'])
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user and revoke refresh token (body is optional)' })
  @ApiEnvelope(200, 'Logged out', null)
  @ApiErrors([401, 'Unauthorized'])
  logout(@CurrentUser('id') userId: string, @Body() logoutDto: LogoutDto) {
    return this.authService.logout(userId, logoutDto?.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current logged in user details' })
  @ApiEnvelope(200, 'Current user profile', UserResponseDto)
  @ApiErrors([401, 'Unauthorized'])
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own profile (name, phone, email, password, avatar, bio)' })
  @ApiEnvelope(200, 'Profile updated', ProfileUpdateResponseDto)
  @ApiErrors([400, 'Validation error'], [401, 'Unauthorized'], [409, 'Email or phone taken by another user'])
  updateMe(@CurrentUser('id') userId: string, @Body() updateMeDto: UpdateMeDto) {
    return this.authService.updateMe(userId, updateMeDto);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete own account permanently (required by App Store)' })
  @ApiEnvelope(200, 'Account deleted', null)
  @ApiErrors([401, 'Unauthorized'])
  deleteMe(@CurrentUser('id') userId: string) {
    return this.authService.deleteMe(userId);
  }
}
