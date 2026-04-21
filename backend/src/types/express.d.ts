declare global {
  namespace Express {
    interface Request {
      userId?: string;
      scope?: "me" | "household";
      /** Members to include for scoped reads (always includes the current user). */
      effectiveUserIds?: string[];
    }
  }
}

export {};
