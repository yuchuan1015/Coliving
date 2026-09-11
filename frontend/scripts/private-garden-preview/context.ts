import { createContext, type ContextType } from "react";
import type { AuthContext as OriginalAuthContext } from "../../src/contexts/AuthContext";
export const AuthContext = createContext<ContextType<typeof OriginalAuthContext>>(null!);
