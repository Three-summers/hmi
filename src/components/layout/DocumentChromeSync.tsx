import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/stores/appStore";

export function DocumentChromeSync() {
    const { theme, visualEffects } = useAppStore(
        useShallow((state) => ({
            theme: state.theme,
            visualEffects: state.visualEffects,
        })),
    );

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    useEffect(() => {
        document.documentElement.dataset.effects = visualEffects;
    }, [visualEffects]);

    return null;
}
