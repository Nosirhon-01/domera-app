import { Controller, Post, Get, Patch, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors } from '../common/swagger/api-responses';
import {
  AuthSessionResponseDto,
  OtpVerifyResponseDto,
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
import { OtpSendDto, OtpVerifyDto } from './dto/otp.dto';
import { OtpLoginService } from './otp/otp-login.service';
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
    private readonly otpLoginService: OtpLoginService,
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

  @Post('otp/send')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with phone, step 1: send a 6-digit code (existing and new numbers)',
    description:
      'SMS_MODE=live: code sent by Eskiz SMS. Otherwise only OTP_DEV_MODE (never production) returns it as devCode; ' +
      'without either → 503. REVIEW_PHONE gets REVIEW_OTP_CODE without SMS or limits. ' +
      'Code valid OTP_EXPIRY_MINUTES (3), 60 s between codes, 5 codes per hour per number.',
  })
  @ApiEnvelope(200, 'Code sent', RegisterCodeResponseDto)
  @ApiErrors(
    [400, 'Invalid phone number, or not a +998 number while SMS is used'],
    [429, 'Resend cooldown or hourly limit (body.retryAfter + Retry-After header), or IP limit'],
    [502, 'Eskiz rejected the SMS. Safe to retry later'],
    [503, 'SMS delivery unavailable (SMS not live / not configured, Eskiz unreachable). Safe to retry later'],
  )
  sendOtp(@Body() dto: OtpSendDto) {
    return this.otpLoginService.send(dto);
  }

  @Post('otp/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with phone, step 2: check the code and log in',
    description:
      'Existing number: logs in (isNewUser=false). New number: creates a USER account (isNewUser=true). ' +
      'needsName=true: show the first/last name screen, then PATCH /auth/me { name }. ' +
      'Tokens are the same as from /auth/login and work with /auth/refresh.',
  })
  @ApiEnvelope(200, 'Login successful', OtpVerifyResponseDto)
  @ApiErrors(
    [400, 'Wrong, expired, already used or not requested code; too many wrong attempts'],
    [401, 'Account is deactivated'],
    [429, 'Too many attempts from this IP'],
  )
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.otpLoginService.verify(dto);
  }

  @Post('register/request-code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 1: send a 6-digit registration code to a new phone number',
    description:
      'SMS_MODE=live: the code is sent by Eskiz SMS. SMS_MODE=test: only the Eskiz test text is sent (no code). ' +
      'With OTP_DEV_MODE=true (never in production) the code is also returned as devCode. ' +
      'Code valid OTP_EXPIRY_MINUTES (3), 60 s between codes, 5 codes per hour per number; ' +
      'a new code invalidates the previous one. A failed SMS does not start the cooldown.',
  })
  @ApiEnvelope(200, 'Code sent', RegisterCodeResponseDto)
  @ApiErrors(
    [400, 'Invalid phone number, or not a +998 number while SMS is used'],
    [409, 'Phone number already registered'],
    [429, 'Resend cooldown or hourly limit (body.retryAfter + Retry-After header), or IP limit'],
    [502, 'Eskiz rejected the SMS (template not approved, no balance, ...). Safe to retry later'],
    [503, 'SMS delivery unavailable (SMS not live / not configured, Eskiz unreachable or login failed)'],
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
    description: 'Returns a one-time verificationToken valid 10 minutes. OTP_MAX_ATTEMPTS (5) wrong attempts lock the code.',
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
