import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { 
  hashPassword, 
  verifyPassword, 
  generateJWT, 
  generateRefreshJWT,
  logSecurityEvent,
  isAccountLocked,
  shouldLockAccount,
  calculateLockoutTime,
  createErrorResponse,
  generateTokenHash,
  generateRandomToken,
  getDeviceInfo,
  authenticateJWT,
  type AuthenticatedRequest
} from '../auth';
import { storage } from '../storage';
import { 
  loginSchema, 
  signupSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema,
  type InsertUser,
  type InsertRefreshToken,
  type InsertPasswordReset,
  type InsertEmailVerification
} from '@shared/schema';
import {
  sendEmail,
  generateVerificationEmailHtml,
  generateVerificationEmailText,
  generatePasswordResetEmailHtml,
  generatePasswordResetEmailText
} from '../utils/email';

const router = express.Router();

// Helper function to get the preferred domain from REPLIT_DOMAINS
// Prefers custom domains (like readacross.io) over .replit.app domains
function getBaseUrl(): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const domains = replitDomains.split(',').map(d => d.trim());
    // Prefer custom domain (non-.replit.app) if available
    const customDomain = domains.find(d => !d.includes('.replit.app'));
    const selectedDomain = customDomain || domains[0];
    return `https://${selectedDomain}`;
  }
  return process.env.APP_URL || 'http://localhost:5000';
}

// Rate limiting middleware
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Increased from 5 to 10 attempts
  message: {
    type: 'https://readacross.io/errors/rate-limit-exceeded',
    title: 'Too many login attempts',
    status: 429,
    detail: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    instance: '/api/auth/login'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for development
  skip: (req) => process.env.NODE_ENV === 'development',
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: {
    type: 'https://readacross.io/errors/rate-limit-exceeded',
    title: 'Too many signup attempts',
    status: 429,
    detail: 'Too many signup attempts from this IP. Please try again after 1 hour.',
    instance: '/api/auth/signup'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: {
    type: 'https://readacross.io/errors/rate-limit-exceeded',
    title: 'Too many password reset attempts',
    status: 429,
    detail: 'Too many password reset requests from this IP. Please try again after 1 hour.',
    instance: '/api/auth/forgot-password'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// User registration with email/password
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    // Validate request body
    const validationResult = signupSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Validation failed',
          422,
          validationResult.error.errors[0].message,
          req.path,
          { field: validationResult.error.errors[0].path[0], code: 'VALIDATION_ERROR' }
        )
      );
    }

    const { username, email, password } = validationResult.data;

    // Check if username already exists
    const existingUsername = await storage.getUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json(
        createErrorResponse(
          'username-exists',
          'Username already exists',
          409,
          'This username is already taken. Please choose a different username.',
          req.path,
          { field: 'username', code: 'ALREADY_EXISTS' }
        )
      );
    }

    // Check if email already exists
    const existingEmail = await storage.getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json(
        createErrorResponse(
          'email-exists',
          'Email already exists',
          409,
          'An account with this email already exists. Please use a different email or try logging in.',
          req.path,
          { field: 'email', code: 'ALREADY_EXISTS' }
        )
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user with 'pending' status (requires email verification)
    const newUser: InsertUser = {
      username,
      email,
      password: hashedPassword,
      role: 'user',
      emailVerifiedAt: null
    };

    const user = await storage.createUser(newUser);

    // Create email verification token
    const verificationToken = generateRandomToken(32);
    const tokenHash = generateTokenHash(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const emailVerification: InsertEmailVerification = {
      userId: user.id,
      tokenHash,
      expiresAt
    };

    await storage.createEmailVerification(emailVerification);

    // Send verification email
    const baseUrl = getBaseUrl();
    const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      to: email,
      subject: 'Verify Your Email - ReadAcross',
      html: generateVerificationEmailHtml(username, verificationUrl),
      text: generateVerificationEmailText(username, verificationUrl)
    });

    await logSecurityEvent('signup_email', user.id, req.ip, req.get('User-Agent'));

    res.status(201).json({
      message: 'Account created successfully. Please check your email to verify your account.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred during signup',
        req.path
      )
    );
  }
});

// User login with email/password
router.post('/login', loginLimiter, async (req, res) => {
  try {
    // Validate request body
    const validationResult = loginSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Validation failed',
          422,
          validationResult.error.errors[0].message,
          req.path,
          { field: validationResult.error.errors[0].path[0], code: 'VALIDATION_ERROR' }
        )
      );
    }

    const { email, password } = validationResult.data;

    // Find user by email
    const user = await storage.getUserByEmail(email);
    if (!user) {
      return res.status(401).json(
        createErrorResponse(
          'invalid-credentials',
          'Invalid credentials',
          401,
          'Invalid email or password',
          req.path
        )
      );
    }

    // Check if account is locked
    const locked = isAccountLocked(user);
    if (locked) {
      const lockoutMinutes = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60000);
      return res.status(403).json(
        createErrorResponse(
          'account-locked',
          'Account locked',
          403,
          `Too many failed login attempts. Account is locked for ${lockoutMinutes} more minutes.`,
          req.path,
          { lockoutMinutes }
        )
      );
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      // Increment failed attempts
      const newFailedAttempts = user.failedAttempts + 1;
      const shouldLock = shouldLockAccount(newFailedAttempts);
      
      const updateData: any = { failedAttempts: newFailedAttempts };
      if (shouldLock) {
        updateData.lockedUntil = calculateLockoutTime(newFailedAttempts);
      }
      
      await storage.updateUser(user.id, updateData);
      await logSecurityEvent('login_failed_invalid_password', user.id, req.ip, req.get('User-Agent'));

      return res.status(401).json(
        createErrorResponse(
          'invalid-credentials',
          'Invalid credentials',
          401,
          'Invalid email or password',
          req.path
        )
      );
    }

    // Check if email is verified
    if (!user.emailVerifiedAt) {
      return res.status(403).json(
        createErrorResponse(
          'email-not-verified',
          'Email not verified',
          403,
          'Please verify your email address before logging in. Check your inbox for the verification link.',
          req.path
        )
      );
    }

    // Reset failed attempts on successful login
    await storage.updateUser(user.id, { 
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date()
    });

    // Generate tokens
    const accessToken = generateJWT(user.id, user.passwordVersion);
    const refreshToken = generateRefreshJWT(user.id);
    const tokenHash = generateTokenHash(refreshToken);
    
    // Store refresh token
    const deviceInfo = getDeviceInfo(req);
    const newRefreshToken: InsertRefreshToken = {
      userId: user.id,
      tokenHash,
      deviceLabel: deviceInfo.deviceLabel,
      platform: deviceInfo.platform,
      userAgent: deviceInfo.userAgent,
      ipAddress: deviceInfo.ipAddress || '',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    };

    await storage.createRefreshToken(newRefreshToken);
    await logSecurityEvent('login_email', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred during login',
        req.path
      )
    );
  }
});

// Forgot password - Request password reset
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    // Validate request body
    const validationResult = forgotPasswordSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Validation failed',
          422,
          validationResult.error.errors[0].message,
          req.path,
          { field: validationResult.error.errors[0].path[0], code: 'VALIDATION_ERROR' }
        )
      );
    }

    const { email } = validationResult.data;

    // Find user by email
    const user = await storage.getUserByEmail(email);
    
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Don't allow password reset for OAuth users
    if (user.oauthProvider) {
      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = generateRandomToken(32);
    const tokenHash = generateTokenHash(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const passwordReset: InsertPasswordReset = {
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress: req.ip || ''
    };

    await storage.createPasswordReset(passwordReset);

    // Send password reset email
    const baseUrl = getBaseUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    
    await sendEmail({
      to: email,
      subject: 'Reset Your Password - ReadAcross',
      html: generatePasswordResetEmailHtml(user.username, resetUrl),
      text: generatePasswordResetEmailText(user.username, resetUrl)
    });

    await logSecurityEvent('password_reset_requested', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Reset password - Complete password reset
router.post('/reset-password', async (req, res) => {
  try {
    // Validate request body
    const validationResult = resetPasswordSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Validation failed',
          422,
          validationResult.error.errors[0].message,
          req.path,
          { field: validationResult.error.errors[0].path[0], code: 'VALIDATION_ERROR' }
        )
      );
    }

    const { token, newPassword } = validationResult.data;

    // Hash token and find reset record
    const tokenHash = generateTokenHash(token);
    const resetRecord = await storage.getPasswordReset(tokenHash);

    if (!resetRecord) {
      return res.status(400).json(
        createErrorResponse(
          'invalid-token',
          'Invalid or expired token',
          400,
          'This password reset link is invalid or has expired. Please request a new one.',
          req.path
        )
      );
    }

    // Check if token has already been used
    if (resetRecord.usedAt) {
      return res.status(400).json(
        createErrorResponse(
          'token-already-used',
          'Token already used',
          400,
          'This password reset link has already been used. Please request a new one if you need to reset your password again.',
          req.path
        )
      );
    }

    // Check if token has expired
    if (resetRecord.expiresAt < new Date()) {
      return res.status(400).json(
        createErrorResponse(
          'token-expired',
          'Token expired',
          400,
          'This password reset link has expired. Please request a new one.',
          req.path
        )
      );
    }

    // Get user
    const user = await storage.getUser(resetRecord.userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);
    const newPasswordVersion = user.passwordVersion + 1;

    // Update user password
    await storage.updateUser(user.id, {
      password: hashedPassword,
      passwordVersion: newPasswordVersion,
      failedAttempts: 0,
      lockedUntil: null
    });

    // Mark token as used
    await storage.markPasswordResetAsUsed(resetRecord.id);

    // Invalidate all refresh tokens (force re-login on all devices)
    await storage.deleteRefreshTokensByUserId(user.id);

    await logSecurityEvent('password_reset_completed', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'Password reset successful. You can now log in with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Verify email
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json(
        createErrorResponse(
          'missing-token',
          'Missing verification token',
          400,
          'Verification token is required',
          req.path
        )
      );
    }

    // Hash token and find verification record
    const tokenHash = generateTokenHash(token);
    const verificationRecord = await storage.getEmailVerification(tokenHash);

    if (!verificationRecord) {
      return res.status(400).json(
        createErrorResponse(
          'invalid-token',
          'Invalid or expired token',
          400,
          'This verification link is invalid or has expired.',
          req.path
        )
      );
    }

    // Check if token has already been used
    if (verificationRecord.usedAt) {
      return res.status(400).json(
        createErrorResponse(
          'token-already-used',
          'Token already used',
          400,
          'This email has already been verified.',
          req.path
        )
      );
    }

    // Check if token has expired
    if (verificationRecord.expiresAt < new Date()) {
      return res.status(400).json(
        createErrorResponse(
          'token-expired',
          'Token expired',
          400,
          'This verification link has expired. Please request a new one.',
          req.path
        )
      );
    }

    // Get user
    const user = await storage.getUser(verificationRecord.userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Update user to verified and active
    await storage.updateUser(user.id, {
      emailVerifiedAt: new Date(),
      status: 'active'
    });

    // Mark verification token as used
    await storage.markEmailVerificationAsUsed(verificationRecord.id);

    await logSecurityEvent('email_verified', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'Email verified successfully. You can now log in.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Verify email (POST version for frontend compatibility)
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json(
        createErrorResponse(
          'missing-token',
          'Missing verification token',
          400,
          'Verification token is required',
          req.path
        )
      );
    }

    // Hash token and find verification record
    const tokenHash = generateTokenHash(token);
    console.log('[VERIFY-EMAIL] Token received:', token.substring(0, 10) + '...');
    console.log('[VERIFY-EMAIL] Token hash:', tokenHash);
    const verificationRecord = await storage.getEmailVerification(tokenHash);
    console.log('[VERIFY-EMAIL] Record found:', verificationRecord ? 'yes' : 'no');

    if (!verificationRecord) {
      return res.status(400).json(
        createErrorResponse(
          'invalid-token',
          'Invalid or expired token',
          400,
          'This verification link is invalid or has expired.',
          req.path
        )
      );
    }

    // Check if token has already been used
    if (verificationRecord.usedAt) {
      return res.status(400).json(
        createErrorResponse(
          'token-already-used',
          'Token already used',
          400,
          'This email has already been verified.',
          req.path
        )
      );
    }

    // Check if token has expired
    if (verificationRecord.expiresAt < new Date()) {
      return res.status(400).json(
        createErrorResponse(
          'token-expired',
          'Token expired',
          400,
          'This verification link has expired. Please request a new one.',
          req.path
        )
      );
    }

    // Get user
    const user = await storage.getUser(verificationRecord.userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Update user to verified and active
    await storage.updateUser(user.id, {
      emailVerifiedAt: new Date(),
      status: 'active'
    });

    // Mark verification token as used
    await storage.markEmailVerificationAsUsed(verificationRecord.id);

    await logSecurityEvent('email_verified', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'Email verified successfully. You can now log in.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(
        createErrorResponse(
          'missing-email',
          'Missing email',
          400,
          'Email address is required',
          req.path
        )
      );
    }

    // Find user by email
    const user = await storage.getUserByEmail(email.toLowerCase().trim());
    
    if (!user) {
      // Don't reveal if email exists or not
      return res.json({
        message: 'If an account exists with that email, a verification link has been sent.'
      });
    }

    // Check if already verified
    if (user.emailVerifiedAt) {
      return res.json({
        message: 'This email has already been verified. You can log in.'
      });
    }

    // Generate new verification token
    const verificationToken = generateRandomToken();
    const tokenHash = generateTokenHash(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store verification token
    await storage.createEmailVerification({
      userId: user.id,
      tokenHash,
      expiresAt
    });

    // Send verification email
    const baseUrl = getBaseUrl();
    const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

    await sendEmail({
      to: user.email!,
      subject: 'Verify your ReadAcross email',
      html: generateVerificationEmailHtml(user.username || 'User', verificationUrl),
      text: generateVerificationEmailText(user.username || 'User', verificationUrl)
    });

    await logSecurityEvent('verification_email_resent', user.id, req.ip, req.get('User-Agent'));

    res.json({
      message: 'If an account exists with that email, a verification link has been sent.'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Get current user info (protected route)
router.get('/me', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          401,
          'User information not available',
          req.path
        )
      );
    }

    res.json({
      message: 'User authenticated successfully',
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        status: req.user.status,
        role: req.user.role,
        plan: req.user.plan === "beta_pro" ? "pro" : req.user.plan,
        planType: req.user.planType,
        planExpiresAt: req.user.planExpiresAt,
        emailVerifiedAt: req.user.emailVerifiedAt,
        lastLoginAt: req.user.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred',
        req.path
      )
    );
  }
});

// Logout (invalidate refresh token)
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = generateTokenHash(refreshToken);
      const token = await storage.getRefreshToken(tokenHash);
      
      if (token) {
        await storage.deleteRefreshToken(token.id);
        await logSecurityEvent('logout', token.userId, req.ip, req.get('User-Agent'));
      }
    }

    res.json({
      message: '로그아웃이 완료되었습니다.'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred during logout',
        req.path
      )
    );
  }
});

// Change password (protected route)
router.post('/change-password', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Missing required fields',
          422,
          'Current password and new password are required',
          req.path,
          { field: !currentPassword ? 'currentPassword' : 'newPassword', code: 'REQUIRED_FIELD' }
        )
      );
    }

    // Validate new password strength (same as signup)
    if (newPassword.length < 8) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Password too weak',
          422,
          'Password must be at least 8 characters long',
          req.path,
          { field: 'newPassword', code: 'WEAK_PASSWORD' }
        )
      );
    }

    // Get current user
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      await logSecurityEvent('password_change_failed_invalid_current', userId, req.ip, req.get('User-Agent'));
      
      return res.status(401).json(
        createErrorResponse(
          'invalid-credentials',
          'Invalid current password',
          401,
          'The current password you entered is incorrect',
          req.path
        )
      );
    }

    // Check if new password is different from current
    const isSamePassword = await verifyPassword(newPassword, user.password);
    if (isSamePassword) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Password unchanged',
          422,
          'New password must be different from your current password',
          req.path,
          { field: 'newPassword', code: 'SAME_PASSWORD' }
        )
      );
    }

    // Hash new password and update user
    const hashedNewPassword = await hashPassword(newPassword);
    const newPasswordVersion = user.passwordVersion + 1;
    
    await storage.updateUser(userId, { 
      password: hashedNewPassword,
      passwordVersion: newPasswordVersion
    });

    // Invalidate all refresh tokens (force re-login on all devices)
    await storage.deleteRefreshTokensByUserId(userId);

    await logSecurityEvent('password_changed', userId, req.ip, req.get('User-Agent'));

    res.json({
      message: '비밀번호가 성공적으로 변경되었습니다. 보안을 위해 모든 기기에서 다시 로그인해주세요.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    await logSecurityEvent('password_change_error', req.userId, req.ip, req.get('User-Agent'), {
      error: (error as Error).message
    });

    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred while changing password',
        req.path
      )
    );
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json(
        createErrorResponse(
          'refresh-token-required',
          'Refresh token required',
          401,
          'Refresh token is required to get a new access token',
          req.path
        )
      );
    }

    const tokenHash = generateTokenHash(refreshToken);
    const storedToken = await storage.getRefreshToken(tokenHash);

    if (!storedToken || storedToken.expiresAt < new Date()) {
      return res.status(401).json(
        createErrorResponse(
          'invalid-refresh-token',
          'Invalid refresh token',
          401,
          'The refresh token is invalid or has expired',
          req.path
        )
      );
    }

    const user = await storage.getUser(storedToken.userId);
    if (!user) {
      return res.status(401).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          401,
          'The user associated with this token no longer exists',
          req.path
        )
      );
    }

    // Generate new access token
    const newAccessToken = generateJWT(user.id, user.passwordVersion);

    // Update last used time
    await storage.updateRefreshToken(storedToken.id, { 
      lastUsedAt: new Date() 
    });

    await logSecurityEvent('token_refreshed', user.id, req.ip, req.get('User-Agent'));

    res.json({
      accessToken: newAccessToken
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred during token refresh',
        req.path
      )
    );
  }
});

// Google OAuth routes
router.get('/google', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    return res.status(500).json(
      createErrorResponse(
        'oauth-config-error',
        'OAuth configuration error',
        500,
        'Google OAuth is not configured on the server',
        req.path
      )
    );
  }

  // Determine redirect URI based on environment
  let domain: string;
  if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_DOMAIN) {
    // Use production domain if set
    domain = process.env.PRODUCTION_DOMAIN;
  } else if (process.env.NODE_ENV === 'production') {
    // Fallback to request host in production
    domain = req.get('host') || 'readacross.io';
  } else {
    // Development: use REPLIT_DEV_DOMAIN or request host
    domain = process.env.REPLIT_DEV_DOMAIN || req.get('host') || 'localhost:5000';
  }
  
  const redirectUri = `https://${domain}/api/auth/google/callback`;
  const scope = 'openid email profile';
  const state = crypto.randomBytes(32).toString('hex');
  
  console.log('[Google OAuth] Environment:', process.env.NODE_ENV);
  console.log('[Google OAuth] Redirect URI:', redirectUri);
  
  // Store state in session or a temporary cache (simplified for now)
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  
  res.redirect(googleAuthUrl);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;

    if (error) {
      console.error('[Google OAuth] Error:', error, error_description);
      return res.redirect(`/login?error=${encodeURIComponent(error_description as string || 'OAuth authentication failed')}`);
    }

    if (!code) {
      return res.redirect('/login?error=' + encodeURIComponent('No authorization code received'));
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!googleClientId || !googleClientSecret) {
      return res.redirect('/login?error=' + encodeURIComponent('Google OAuth is not configured'));
    }

    // Determine redirect URI based on environment (must match the initial request)
    let domain: string;
    if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_DOMAIN) {
      domain = process.env.PRODUCTION_DOMAIN;
    } else if (process.env.NODE_ENV === 'production') {
      domain = req.get('host') || 'readacross.io';
    } else {
      domain = process.env.REPLIT_DEV_DOMAIN || req.get('host') || 'localhost:5000';
    }
    
    const redirectUri = `https://${domain}/api/auth/google/callback`;
    
    console.log('[Google OAuth] Callback - Environment:', process.env.NODE_ENV);
    console.log('[Google OAuth] Callback - Redirect URI:', redirectUri);

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('[Google OAuth] Token exchange failed:', errorData);
      return res.redirect('/login?error=' + encodeURIComponent('Failed to authenticate with Google'));
    }

    const tokenData = await tokenResponse.json();
    const { id_token, access_token } = tokenData;

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      return res.redirect('/login?error=' + encodeURIComponent('Failed to get user information'));
    }

    const googleUser = await userInfoResponse.json();
    const { email, name, picture, sub } = googleUser;

    // Check if user exists by OAuth provider ID first, then by email
    let user = await storage.getUserByEmail(email);
    let isNewUser = false;

    if (!user) {
      // Create new user with temporary username
      const tempUsername = email.split('@')[0] + '_' + crypto.randomBytes(4).toString('hex');
      const newUser: InsertUser = {
        username: tempUsername,
        email,
        password: await hashPassword(crypto.randomBytes(32).toString('hex')), // Random password for OAuth users
        role: 'user',
        emailVerifiedAt: new Date(), // Auto-verify OAuth users
        oauthProvider: 'google',
        oauthProviderId: sub, // Google's unique user ID
        needsUsernameSetup: true, // Flag for username selection
      };

      user = await storage.createUser(newUser);
      isNewUser = true;

      await logSecurityEvent('google_oauth_signup', user.id, req.ip, req.get('User-Agent'), {
        email,
        name,
        oauthProvider: 'google',
      });
    } else {
      // Update OAuth info if not already set
      if (!user.oauthProvider) {
        await storage.updateUser(user.id, {
          oauthProvider: 'google',
          oauthProviderId: sub,
        });
      }

      await logSecurityEvent('google_oauth_login', user.id, req.ip, req.get('User-Agent'), {
        email,
      });
    }

    // Update last login
    await storage.updateUser(user.id, { lastLoginAt: new Date() });

    // Store user ID in session (secure, server-side only)
    req.session.userId = user.id;
    req.session.oauthProvider = 'google';

    // Redirect based on whether user needs username setup
    // Check needsUsernameSetup flag (not just isNewUser) so returning users can still set their username
    if (user.needsUsernameSetup) {
      res.redirect('/setup-username?oauth_success=true');
    } else {
      res.redirect('/login?oauth_success=true');
    }

  } catch (error) {
    console.error('[Google OAuth] Callback error:', error);
    res.redirect('/login?error=' + encodeURIComponent('An error occurred during authentication'));
  }
});

// Exchange session for tokens (secure OAuth flow)
router.post('/session', async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ message: 'No active OAuth session' });
    }

    // Load user
    const user = await storage.getUser(userId);
    if (!user) {
      // Clear invalid session
      req.session.userId = undefined;
      req.session.oauthProvider = undefined;
      return res.status(401).json({ message: 'User not found' });
    }

    // Generate JWT tokens
    const accessTokenJWT = generateJWT(user.id, user.passwordVersion);
    const refreshTokenJWT = generateRefreshJWT(user.id);
    const refreshTokenHash = generateTokenHash(refreshTokenJWT);

    // Store refresh token
    const deviceInfo = getDeviceInfo(req);
    const refreshTokenData: InsertRefreshToken = {
      userId: user.id,
      tokenHash: refreshTokenHash,
      deviceLabel: deviceInfo.deviceLabel,
      platform: deviceInfo.platform,
      userAgent: deviceInfo.userAgent,
      ipAddress: deviceInfo.ipAddress,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    };

    await storage.createRefreshToken(refreshTokenData);

    // Clear session data (one-time use)
    req.session.userId = undefined;
    req.session.oauthProvider = undefined;

    // Return tokens
    res.json({
      accessToken: accessTokenJWT,
      refreshToken: refreshTokenJWT,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });

  } catch (error) {
    console.error('[Session Exchange] Error:', error);
    res.status(500).json({ message: 'Failed to exchange session for tokens' });
  }
});

// Check username availability
router.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query;

    if (!username || typeof username !== 'string') {
      return res.status(422).json({ available: false, message: 'Username is required' });
    }

    // Validate username format
    if (username.length < 3 || username.length > 30) {
      return res.status(422).json({ available: false, message: 'Invalid username length' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(422).json({ available: false, message: 'Invalid username format' });
    }

    // Check if username exists
    const existingUser = await storage.getUserByUsername(username);
    
    res.json({
      available: !existingUser,
      message: existingUser ? 'Username already taken' : 'Username available'
    });

  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ available: false, message: 'Error checking username' });
  }
});

// Setup username for first-time OAuth users
router.post('/setup-username', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    
    // Debug log to see what's coming in
    console.log('[setup-username] Request body:', req.body);
    console.log('[setup-username] Content-Type:', req.get('Content-Type'));
    
    const { username } = req.body || {};

    if (!username) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Username required',
          422,
          'Username is required',
          req.path,
          { field: 'username', code: 'REQUIRED_FIELD' }
        )
      );
    }

    // Validate username format
    if (username.length < 3 || username.length > 30) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Invalid username length',
          422,
          'Username must be between 3 and 30 characters',
          req.path,
          { field: 'username', code: 'INVALID_LENGTH' }
        )
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Invalid username format',
          422,
          'Username can only contain letters, numbers, underscores, and hyphens',
          req.path,
          { field: 'username', code: 'INVALID_FORMAT' }
        )
      );
    }

    // Check if username is already taken
    const existingUser = await storage.getUserByUsername(username);
    if (existingUser) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Username already exists',
          422,
          'This username is already taken. Please choose a different one.',
          req.path,
          { field: 'username', code: 'USERNAME_TAKEN' }
        )
      );
    }

    // Update username and clear needsUsernameSetup flag
    await storage.updateUser(userId, {
      username,
      needsUsernameSetup: false
    });

    await logSecurityEvent('username_setup_completed', userId, req.ip, req.get('User-Agent'), {
      newUsername: username
    });

    res.json({
      message: 'Username set successfully',
      username
    });

  } catch (error) {
    console.error('Setup username error:', error);
    await logSecurityEvent('username_setup_error', req.userId, req.ip, req.get('User-Agent'), {
      error: (error as Error).message
    });

    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred while setting username',
        req.path
      )
    );
  }
});

// Change username for existing users
router.put('/change-username', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { username } = req.body;

    if (!username) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Username required',
          422,
          'Username is required',
          req.path,
          { field: 'username', code: 'REQUIRED_FIELD' }
        )
      );
    }

    // Get current user
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Check if username is the same
    if (user.username === username) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Same username',
          422,
          'New username must be different from current username',
          req.path,
          { field: 'username', code: 'SAME_USERNAME' }
        )
      );
    }

    // Validate username format
    if (username.length < 3 || username.length > 30) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Invalid username length',
          422,
          'Username must be between 3 and 30 characters',
          req.path,
          { field: 'username', code: 'INVALID_LENGTH' }
        )
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Invalid username format',
          422,
          'Username can only contain letters, numbers, underscores, and hyphens',
          req.path,
          { field: 'username', code: 'INVALID_FORMAT' }
        )
      );
    }

    // Check if username is already taken
    const existingUser = await storage.getUserByUsername(username);
    if (existingUser) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Username already exists',
          422,
          'This username is already taken. Please choose a different one.',
          req.path,
          { field: 'username', code: 'USERNAME_TAKEN' }
        )
      );
    }

    // Update username
    await storage.updateUser(userId, { username });

    await logSecurityEvent('username_changed', userId, req.ip, req.get('User-Agent'), {
      oldUsername: user.username,
      newUsername: username
    });

    res.json({
      message: 'Username changed successfully',
      username
    });

  } catch (error) {
    console.error('Change username error:', error);
    await logSecurityEvent('username_change_error', req.userId, req.ip, req.get('User-Agent'), {
      error: (error as Error).message
    });

    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred while changing username',
        req.path
      )
    );
  }
});

// Set password for OAuth users who don't have one
router.post('/set-password', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { password } = req.body;

    if (!password) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Password required',
          422,
          'Password is required',
          req.path,
          { field: 'password', code: 'REQUIRED_FIELD' }
        )
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(422).json(
        createErrorResponse(
          'validation-error',
          'Password too weak',
          422,
          'Password must be at least 8 characters long',
          req.path,
          { field: 'password', code: 'WEAK_PASSWORD' }
        )
      );
    }

    // Get current user
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json(
        createErrorResponse(
          'user-not-found',
          'User not found',
          404,
          'User account not found',
          req.path
        )
      );
    }

    // Check if this is an OAuth user trying to set password for the first time
    // OAuth users have random passwords generated, we'll allow them to set a real one
    
    // Hash new password
    const hashedPassword = await hashPassword(password);
    const newPasswordVersion = user.passwordVersion + 1;
    
    await storage.updateUser(userId, { 
      password: hashedPassword,
      passwordVersion: newPasswordVersion
    });

    await logSecurityEvent('password_set', userId, req.ip, req.get('User-Agent'), {
      isOAuthUser: !!user.oauthProvider
    });

    res.json({
      message: '비밀번호가 성공적으로 설정되었습니다.'
    });

  } catch (error) {
    console.error('Set password error:', error);
    await logSecurityEvent('password_set_error', req.userId, req.ip, req.get('User-Agent'), {
      error: (error as Error).message
    });

    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'An unexpected error occurred while setting password',
        req.path
      )
    );
  }
});

// Delete user account
router.delete('/account', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;

    // Log the account deletion attempt
    await logSecurityEvent('account_deletion_requested', userId, req.ip, req.get('User-Agent'));

    // Delete all user-related data
    // The following deletions cascade automatically via database constraints:
    // - refreshTokens (onDelete: cascade)
    // - passwordResets (onDelete: cascade)
    // - emailVerifications (onDelete: cascade)
    // - notes (via sentenceId cascade when sentences are deleted)
    // - userSentenceState (via sentenceId cascade when sentences are deleted)

    // Manually delete user-specific data
    await storage.deleteUserData(userId);

    // Delete the user account (this will cascade to related tables with onDelete: cascade)
    await storage.deleteUser(userId);

    await logSecurityEvent('account_deleted', userId, req.ip, req.get('User-Agent'));

    // Clear the session/token
    res.json({
      message: '계정이 성공적으로 삭제되었습니다.'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json(
      createErrorResponse(
        'internal-server-error',
        'Internal server error',
        500,
        'Failed to delete account',
        req.path
      )
    );
  }
});

export default router;