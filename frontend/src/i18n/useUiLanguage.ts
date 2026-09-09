import { useSyncExternalStore } from "react";
import { getUiLanguage, subscribeLanguage } from "./core";

export function useUiLanguage() {
  return useSyncExternalStore(subscribeLanguage, getUiLanguage, () => "zh-TW" as const);
}
