// Type definitions for third-party modules

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    oauthProvider?: string;
  }
}

declare module 'pdf-text-extract' {
  function extract(
    filePath: string, 
    options: { password?: string; [key: string]: any } | undefined,
    callback: (err: Error | null, pages: string[]) => void
  ): void;
  
  function extract(
    filePath: string, 
    callback: (err: Error | null, pages: string[]) => void
  ): void;
  
  export = extract;
}