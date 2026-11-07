import { Controller, Post, Get, Patch, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors } from '../common/swagger/api-responses';
import {
  AuthSessionResponseDto,
  OtpSendResponseDto,
  OtpVerifyResponseDto,
  ProfileUpdateResponseDto,
  UserResponseDto,
} from './dto/auth-responses.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { OtpService } from './otp/otp.service';
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
    private readonly otpService: OtpService,
  ) {}

  // Brute-force protection: limited attempts per client IP
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @ApiOperation({ summary: 'Register a new user (role is always USER)' })
  @ApiEnvelope(201, 'User registered and signed in', AuthSessionResponseDto)
  @ApiErrors([400, 'Validation error'], [409, 'Email or phone already registered'], [429, 'Too many attempts'])
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
  @ApiOperation({ summary: 'Send a 6-digit login code by SMS (60s resend cooldown, code valid 120s)' })
  @ApiEnvelope(200, 'Code sent', OtpSendResponseDto)
  @ApiErrors(
    [400, 'Invalid phone number, or not an Uzbekistan (+998) number when SMS goes through Eskiz'],
    [429, 'Resend cooldown (body.retryAfter + Retry-After header), hourly limit or IP limit'],
    [502, 'Eskiz rejected the SMS (template not approved, no balance, ...). Safe to retry later'],
    [503, 'SMS not configured, or Eskiz unreachable / login failed. Safe to retry later'],
  )
  sendOtp(@Body() dto: SendOtpDto) {
    return this.otpService.send(dto);
  }

  @Post('otp/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: AUTH_RATE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify SMS code and log in',
    description: 'Existing phone: logs in (isNewUser=false). New phone: creates a USER account (isNewUser=true). ' +
      'Tokens are the same as from /auth/login and work with /auth/refresh.',
  })
  @ApiEnvelope(200, 'Login successful', OtpVerifyResponseDto)
  @ApiErrors(
    [400, 'Wrong, expired, already used or not requested code; too many wrong attempts'],
    [401, 'Account is deactivated'],
    [429, 'Too many attempts from this IP'],
  )
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.otpService.verify(dto);
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
