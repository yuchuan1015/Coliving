import { createContext, type ContextType } from "react";
import type { AuthContext as OriginalAuthContext } from "../../src/contexts/AuthContext";

// Type-only reference: never bundle the real account provider or token storage.
export const AuthContext = createContext<ContextType<typeof OriginalAuthContext>>(null!);
