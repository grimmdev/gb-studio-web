import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { installWebRendererApi } from "./api";

// Ensure process is defined in browser
if (typeof (window as any).process === "undefined") {
  (window as any).process = {
    env: { NODE_ENV: "production" },
    platform: "browser",
    browser: true,
    cwd: () => "/",
    nextTick: (fn: any, ...args: any[]) => setTimeout(() => fn(...args), 0),
  };
}

// Install window.API web bridge before any stores/components access it
installWebRendererApi();

import store from "store/configureStore";
import App from "components/app/App";
import AppContainerDnD from "components/app/AppContainerDnD";
import ThemeProvider from "ui/theme/ThemeProvider";
import GlobalStyle from "ui/globalStyle";
import { initTheme } from "renderer/lib/theme";
import { initFullScreenDetector } from "renderer/lib/handleFullScreen";
import initRendererL10N from "renderer/lib/lang/initRendererL10N";
import { initMouseTracking } from "renderer/lib/helpers/mouse";
import { initMusicPlaybackListener } from "renderer/lib/music/initMusicPlaybackListener";
import { initMusicMidiProjectBridge } from "components/music/midi/MusicMidiProjectBridge";
import { initProjectWeb } from "./initProjectWeb";
import { WebPlayModal } from "./components/WebPlayModal";
import { ProjectPickerModal } from "./components/ProjectPickerModal";
import { AuthModal } from "./components/AuthModal";
import { AdminModal } from "./components/AdminModal";
import { UserMenu } from "./components/UserMenu";

initMusicMidiProjectBridge(store);
initMusicPlaybackListener(store.dispatch);

(async () => {
  try {
    await initRendererL10N();
    await initTheme();
    await initFullScreenDetector();
    initMouseTracking();

    const rootEl = document.getElementById("App") as HTMLElement;
    if (rootEl) {
      const root = createRoot(rootEl);
      root.render(
        <React.StrictMode>
          <Provider store={store}>
            <ThemeProvider>
              <GlobalStyle />
              <AppContainerDnD>
                <>
                  <App />
                  <WebPlayModal />
                  <ProjectPickerModal />
                  <AuthModal />
                  <AdminModal />
                  <UserMenu />
                </>
              </AppContainerDnD>
            </ThemeProvider>
          </Provider>
        </React.StrictMode>,
      );
    }

    // Bootstrap project state once root providers and modals are mounted.
    await initProjectWeb();
  } catch (err) {
    console.error("Failed to bootstrap GB Studio Web:", err);
  }
})();
