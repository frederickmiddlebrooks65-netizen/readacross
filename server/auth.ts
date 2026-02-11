import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { storage } from './storage';
import type { User, InsertUser, InsertAuditLog } from '@shared/schema';

// Extended request interface for authenticated routes
export interface AuthenticatedRequest extends Request {
  userId?: number;
  user?: User;
}

// Environment configuration
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';  // 30분 → 2시간으로 연장
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';  // 7일 → 30일로 연장

// Account lockout configuration
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5');
const ACCOUNT_LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

// Token generation utilities
export const generateTokenHash = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const generateRandomToken = (bytes: number = 32): string => {
  return crypto.randomBytes(bytes).toString('hex');
};

// Password utilities
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// JWT utilities
export const generateJWT = (userId: number, passwordVersion: number = 1): string => {
  const payload = { 
    id: userId,
    passwordVersion,
    type: 'access'
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const generateRefreshJWT = (userId: number): string => {
  const payload = { 
    id: userId,
    type: 'refresh'
  };
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
};

// Audit logging
export const logSecurityEvent = async (
  eventType: string,
  userId?: number,
  ipAddress?: string,
  userAgent?: string,
  details?: any
): Promise<void> => {
  try {
    const auditLog: InsertAuditLog = {
      userId,
      eventType,
      ipAddress,
      userAgent,
      details
    };
    await storage.createAuditLog(auditLog);
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

// Account lockout utilities
export const isAccountLocked = (user: User): boolean => {
  if (!user.lockedUntil) return false;
  return new Date() < user.lockedUntil;
};

export const shouldLockAccount = (failedAttempts: number): boolean => {
  return failedAttempts >= MAX_LOGIN_ATTEMPTS;
};

export const calculateLockoutTime = (failedAttempts?: number): Date => {
  return new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION);
};

// RFC7807 compliant error responses
export const createErrorResponse = (
  type: string,
  title: string,
  status: number,
  detail: string,
  instance: string,
  meta?: any
) => {
  return {
    type: `https://readacross.io/errors/${type}`,
    title,
    status,
    detail,
    instance,
    ...(meta && { meta })
  };
};

// Authentication middleware
export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      // Fetch full user information from database
      const user = await storage.getUser(decoded.id);
      if (!user) {
        return res.sendStatus(403);
      }
      
      req.user = user;
      req.userId = user.id;
      next();
    } catch (err) {
      return res.sendStatus(403);
    }
  } else {
    res.sendStatus(401);
  }
};

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(
        createErrorResponse(
          'authentication-required',
          'Authentication required',
          401,
          'You must be authenticated to access this resource',
          req.path
        )
      );
    }

    if (!roles.includes(req.user.role)) {
      await logSecurityEvent('unauthorized_access_attempt', req.user.id, req.ip, req.get('User-Agent'), {
        requiredRoles: roles,
        userRole: req.user.role,
        resource: req.path
      });

      return res.status(403).json(
        createErrorResponse(
          'insufficient-permissions',
          'Insufficient permissions',
          403,
          'You do not have permission to access this resource',
          req.path,
          { requiredRoles: roles }
        )
      );
    }

    next();
  };
};

// Admin middleware
export const requireAdmin = requireRole(['admin']);

// Optional authentication - proceeds without auth if no token provided
// Useful for endpoints that should work for both authenticated and public access
export const optionalAuthenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  // If no auth header, proceed without authentication
  if (!authHeader) {
    req.userId = undefined;
    req.user = undefined;
    return next();
  }

  const token = authHeader.split(' ')[1];
  
  // If auth header exists but is invalid format, proceed without authentication
  if (!token) {
    req.userId = undefined;
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Fetch full user information from database
    const user = await storage.getUser(decoded.id);
    if (user) {
      req.user = user;
      req.userId = user.id;
    } else {
      req.userId = undefined;
      req.user = undefined;
    }
    next();
  } catch (err) {
    // Invalid or expired token - proceed without authentication
    req.userId = undefined;
    req.user = undefined;
    next();
  }
};

// Mock authentication for development (keeping for backward compatibility)
export const mockAuthenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  req.userId = 1;
  next();
};

// JWT 토큰 검증 함수 (기존 호환성 유지)
export const verifyJWT = (token: string): Promise<{ id: number }> => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        reject(err);
      } else {
        resolve(decoded as { id: number });
      }
    });
  });
};

// RSS 피드 소유권 검증 미들웨어 (기존 코드 호환성)
export const validateRSSFeedOwnership = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const feedId = parseInt(req.params.id);
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: '사용자 인증이 필요합니다' });
  }

  try {
    next();
  } catch (error) {
    res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다' });
  }
};

// Extract device information from request
export const getDeviceInfo = (req: Request) => {
  const userAgent = req.get('User-Agent') || '';

  // Simple device detection
  let platform = 'web';
  if (userAgent.includes('Mobile')) platform = 'mobile';
  if (userAgent.includes('Electron')) platform = 'desktop';

  const deviceLabel = `${platform.charAt(0).toUpperCase() + platform.slice(1)} Browser`;

  return {
    platform,
    deviceLabel,
    userAgent,
    ipAddress: req.ip
  };
};